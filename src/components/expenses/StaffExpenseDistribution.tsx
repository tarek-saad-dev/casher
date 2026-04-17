import React, { useState, useEffect } from 'react';

interface StaffMember {
  EmpID: number;
  EmpName: string;
}

interface ExpenseCategory {
  ExpINID: number;
  CatName: string;
}

interface Distribution {
  ID: number;
  ExpenseCategoryID: number;
  ExpenseCategoryName: string;
  StaffMemberID: number;
  StaffMemberName: string;
  DistributionPercentage: number;
  IsActive: boolean;
}

interface Props {
  onDistributionChange?: (distributions: Distribution[]) => void;
}

export default function StaffExpenseDistribution({ onDistributionChange }: Props) {
  const [distributions, setDistributions] = useState<Distribution[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/expenses/distribute');
      if (!response.ok) throw new Error('Failed to load data');
      
      const data = await response.json();
      setDistributions(data.distributions || []);
      setCategories(data.categories || []);
      setStaff(data.staff || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleCategoryChange = (categoryId: number) => {
    setSelectedCategory(categoryId);
  };

  const handlePercentageChange = (staffId: number, percentage: number) => {
    if (!selectedCategory) return;

    const updatedDistributions = distributions.map(dist => 
      dist.ExpenseCategoryID === selectedCategory && dist.StaffMemberID === staffId
        ? { ...dist, DistributionPercentage: percentage }
        : dist
    );

    setDistributions(updatedDistributions);
    onDistributionChange?.(updatedDistributions);
  };

  const handleToggleActive = (staffId: number) => {
    if (!selectedCategory) return;

    const updatedDistributions = distributions.map(dist => 
      dist.ExpenseCategoryID === selectedCategory && dist.StaffMemberID === staffId
        ? { ...dist, IsActive: !dist.IsActive }
        : dist
    );

    setDistributions(updatedDistributions);
    onDistributionChange?.(updatedDistributions);
  };

  const distributeEqually = () => {
    if (!selectedCategory) return;

    const activeStaff = staff.filter(s => 
      !distributions.find(d => d.ExpenseCategoryID === selectedCategory && d.StaffMemberID === s.EmpID && !d.IsActive)
    );

    if (activeStaff.length === 0) return;

    const equalPercentage = Math.round((100 / activeStaff.length) * 100) / 100; // Round to 2 decimal places
    const totalPercentage = equalPercentage * activeStaff.length;
    const adjustment = 100 - totalPercentage;
    
    const updatedDistributions = [...distributions];
    let adjustmentApplied = false;

    activeStaff.forEach((staffMember, index) => {
      let percentage = equalPercentage;
      
      // Apply rounding difference to first staff member
      if (index === 0 && adjustment !== 0) {
        percentage += adjustment;
        adjustmentApplied = true;
      }

      const existingDist = updatedDistributions.find(d => 
        d.ExpenseCategoryID === selectedCategory && d.StaffMemberID === staffMember.EmpID
      );

      if (existingDist) {
        existingDist.DistributionPercentage = percentage;
        existingDist.IsActive = true;
      } else {
        updatedDistributions.push({
          ID: 0,
          ExpenseCategoryID: selectedCategory,
          ExpenseCategoryName: categories.find(c => c.ExpINID === selectedCategory)?.CatName || '',
          StaffMemberID: staffMember.EmpID,
          StaffMemberName: staffMember.EmpName,
          DistributionPercentage: percentage,
          IsActive: true
        });
      }
    });

    setDistributions(updatedDistributions);
    onDistributionChange?.(updatedDistributions);
  };

  const saveDistributions = async () => {
    if (!selectedCategory) return;

    const categoryDistributions = distributions.filter(d => d.ExpenseCategoryID === selectedCategory);

    try {
      const response = await fetch('/api/expenses/distribute', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          distributions: categoryDistributions.map(d => ({
            expenseCategoryId: d.ExpenseCategoryID,
            staffMemberId: d.StaffMemberID,
            distributionPercentage: d.DistributionPercentage,
            isActive: d.IsActive
          }))
        })
      });

      if (!response.ok) throw new Error('Failed to save distributions');
      
      await loadData(); // Reload data
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
  };

  const getCategoryDistributions = () => {
    if (!selectedCategory) return [];
    return distributions.filter(d => d.ExpenseCategoryID === selectedCategory);
  };

  const getTotalPercentage = () => {
    const categoryDists = getCategoryDistributions();
    return categoryDists
      .filter(d => d.IsActive)
      .reduce((sum, d) => sum + d.DistributionPercentage, 0);
  };

  if (loading) return <div className="loading">Loading...</div>;
  if (error) return <div className="error">Error: {error}</div>;

  return (
    <div className="staff-expense-distribution">
      <h3>Staff Expense Distribution</h3>
      
      {/* Category Selection */}
      <div className="form-group">
        <label>Expense Category:</label>
        <select 
          value={selectedCategory || ''} 
          onChange={(e) => handleCategoryChange(Number(e.target.value))}
          className="form-control"
        >
          <option value="">Select category...</option>
          {categories.map(cat => (
            <option key={cat.ExpINID} value={cat.ExpINID}>
              {cat.CatName}
            </option>
          ))}
        </select>
      </div>

      {selectedCategory && (
        <>
          {/* Total Percentage Indicator */}
          <div className="percentage-summary">
            <span className={`total-percentage ${getTotalPercentage() === 100 ? 'valid' : 'invalid'}`}>
              Total: {getTotalPercentage().toFixed(2)}%
            </span>
            {getTotalPercentage() !== 100 && (
              <span className="warning">
                Total must equal 100%
              </span>
            )}
          </div>

          {/* Action Buttons */}
          <div className="action-buttons">
            <button 
              onClick={distributeEqually}
              className="btn btn-primary"
              disabled={staff.length === 0}
            >
              Distribute Equally ({staff.length} staff)
            </button>
            <button 
              onClick={saveDistributions}
              className="btn btn-success"
              disabled={getTotalPercentage() !== 100}
            >
              Save Distribution
            </button>
          </div>

          {/* Distribution Table */}
          <div className="distribution-table">
            <table className="table">
              <thead>
                <tr>
                  <th>Staff Member</th>
                  <th>Percentage</th>
                  <th>Amount (260 EGP)</th>
                  <th>Active</th>
                </tr>
              </thead>
              <tbody>
                {staff.map(staffMember => {
                  const distribution = getCategoryDistributions().find(d => d.StaffMemberID === staffMember.EmpID);
                  const percentage = distribution?.DistributionPercentage || 0;
                  const isActive = distribution?.IsActive ?? true;
                  const amount = (260 * percentage) / 100;

                  return (
                    <tr key={staffMember.EmpID}>
                      <td>{staffMember.EmpName}</td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={percentage}
                          onChange={(e) => handlePercentageChange(staffMember.EmpID, Number(e.target.value))}
                          disabled={!isActive}
                          className="form-control-sm"
                        />
                        %
                      </td>
                      <td>{amount.toFixed(2)} EGP</td>
                      <td>
                        <label className="checkbox">
                          <input
                            type="checkbox"
                            checked={isActive}
                            onChange={() => handleToggleActive(staffMember.EmpID)}
                          />
                          Active
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Example Calculation */}
          <div className="example-calculation">
            <h4>Example: Internet 260 EGP</h4>
            {getCategoryDistributions().filter(d => d.IsActive).map(d => (
              <div key={d.StaffMemberID}>
                {d.StaffMemberName}: {((260 * d.DistributionPercentage) / 100).toFixed(2)} EGP
              </div>
            ))}
          </div>
        </>
      )}

      <style jsx>{`
        .staff-expense-distribution {
          padding: 20px;
          max-width: 800px;
        }

        .form-group {
          margin-bottom: 15px;
        }

        .form-group label {
          display: block;
          margin-bottom: 5px;
          font-weight: bold;
        }

        .form-control {
          width: 100%;
          padding: 8px;
          border: 1px solid #ddd;
          border-radius: 4px;
        }

        .form-control-sm {
          width: 80px;
          padding: 4px;
          border: 1px solid #ddd;
          border-radius: 4px;
        }

        .percentage-summary {
          margin: 15px 0;
          padding: 10px;
          background: #f8f9fa;
          border-radius: 4px;
        }

        .total-percentage.valid {
          color: #28a745;
          font-weight: bold;
        }

        .total-percentage.invalid {
          color: #dc3545;
          font-weight: bold;
        }

        .warning {
          color: #dc3545;
          margin-left: 10px;
        }

        .action-buttons {
          margin: 20px 0;
        }

        .btn {
          padding: 8px 16px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          margin-right: 10px;
        }

        .btn-primary {
          background: #007bff;
          color: white;
        }

        .btn-success {
          background: #28a745;
          color: white;
        }

        .btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .distribution-table {
          margin: 20px 0;
        }

        .table {
          width: 100%;
          border-collapse: collapse;
        }

        .table th,
        .table td {
          padding: 8px;
          text-align: left;
          border-bottom: 1px solid #ddd;
        }

        .table th {
          background: #f8f9fa;
          font-weight: bold;
        }

        .checkbox {
          display: flex;
          align-items: center;
        }

        .checkbox input {
          margin-right: 5px;
        }

        .example-calculation {
          margin-top: 20px;
          padding: 15px;
          background: #e9ecef;
          border-radius: 4px;
        }

        .example-calculation h4 {
          margin-top: 0;
        }

        .loading, .error {
          text-align: center;
          padding: 20px;
        }

        .error {
          color: #dc3545;
        }
      `}</style>
    </div>
  );
}
