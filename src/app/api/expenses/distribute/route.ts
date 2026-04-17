import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';

// GET /api/expenses/distribute - Get staff distribution settings
export async function GET(req: NextRequest) {
  try {
    const db = await getPool();
    const url = new URL(req.url);
    const categoryId = url.searchParams.get('categoryId');

    let whereClause = "WHERE sd.IsActive = 1";
    const request = db.request();

    if (categoryId) {
      whereClause += ' AND sd.ExpenseCategoryID = @categoryId';
      request.input('categoryId', sql.Int, parseInt(categoryId));
    }

    const result = await request.query(`
      SELECT 
        sd.ID,
        sd.ExpenseCategoryID,
        cat.CatName AS ExpenseCategoryName,
        sd.StaffMemberID,
        e.EmpName AS StaffMemberName,
        sd.DistributionPercentage,
        sd.IsActive,
        sd.CreatedDate,
        sd.ModifiedDate
      FROM [dbo].[TblStaffExpenseDistribution] sd
      INNER JOIN [dbo].[TblExpINCat] cat ON sd.ExpenseCategoryID = cat.ExpINID
      INNER JOIN [dbo].[TblEmp] e ON sd.StaffMemberID = e.EmpID
      ${whereClause}
      ORDER BY cat.CatName, e.EmpName
    `);

    // Also get available categories and staff for setup
    const categoriesResult = await db.request().query(`
      SELECT ExpINID, CatName 
      FROM [dbo].[TblExpINCat] 
      WHERE ExpINType = N'expenses'
      ORDER BY CatName
    `);

    const staffResult = await db.request().query(`
      SELECT EmpID, EmpName 
      FROM [dbo].[TblEmp]
      WHERE IsActive = 1
      ORDER BY EmpName
    `);

    return NextResponse.json({
      distributions: result.recordset,
      categories: categoriesResult.recordset,
      staff: staffResult.recordset
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/expenses/distribute] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/expenses/distribute - Create or update staff distribution
export async function POST(req: NextRequest) {
  try {
    const sessionUser = await getSession();
    if (!sessionUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { expenseCategoryId, staffMemberId, distributionPercentage } = body;

    // Validation
    if (!expenseCategoryId || expenseCategoryId <= 0) {
      return NextResponse.json({ error: 'Expense category is required' }, { status: 400 });
    }
    if (!staffMemberId || staffMemberId <= 0) {
      return NextResponse.json({ error: 'Staff member is required' }, { status: 400 });
    }
    if (!distributionPercentage || distributionPercentage <= 0 || distributionPercentage > 100) {
      return NextResponse.json({ error: 'Distribution percentage must be between 0 and 100' }, { status: 400 });
    }

    const db = await getPool();

    // Check if distribution already exists
    const existingResult = await db.request()
      .input('expenseCategoryId', sql.Int, expenseCategoryId)
      .input('staffMemberId', sql.Int, staffMemberId)
      .query(`
        SELECT ID FROM [dbo].[TblStaffExpenseDistribution]
        WHERE ExpenseCategoryID = @expenseCategoryId AND StaffMemberID = @staffMemberId
      `);

    let result;
    if (existingResult.recordset.length > 0) {
      // Update existing
      result = await db.request()
        .input('expenseCategoryId', sql.Int, expenseCategoryId)
        .input('staffMemberId', sql.Int, staffMemberId)
        .input('distributionPercentage', sql.Decimal(5, 2), distributionPercentage)
        .query(`
          UPDATE [dbo].[TblStaffExpenseDistribution]
          SET DistributionPercentage = @distributionPercentage,
              ModifiedDate = GETDATE(),
              IsActive = 1
          WHERE ExpenseCategoryID = @expenseCategoryId AND StaffMemberID = @staffMemberId
          
          SELECT ID, 'updated' as action FROM [dbo].[TblStaffExpenseDistribution]
          WHERE ExpenseCategoryID = @expenseCategoryId AND StaffMemberID = @staffMemberId
        `);
    } else {
      // Create new
      result = await db.request()
        .input('expenseCategoryId', sql.Int, expenseCategoryId)
        .input('staffMemberId', sql.Int, staffMemberId)
        .input('distributionPercentage', sql.Decimal(5, 2), distributionPercentage)
        .query(`
          INSERT INTO [dbo].[TblStaffExpenseDistribution] (
            ExpenseCategoryID, StaffMemberID, DistributionPercentage, IsActive
          ) VALUES (
            @expenseCategoryId, @staffMemberId, @distributionPercentage, 1
          )
          
          SELECT SCOPE_IDENTITY() as ID, 'created' as action
        `);
    }

    return NextResponse.json({
      id: result.recordset[0].ID,
      action: result.recordset[0].action,
      message: `Distribution ${result.recordset[0].action} successfully`
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/expenses/distribute] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT /api/expenses/distribute - Update multiple distributions at once
export async function PUT(req: NextRequest) {
  try {
    const sessionUser = await getSession();
    if (!sessionUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { distributions } = body; // Array of {expenseCategoryId, staffMemberId, distributionPercentage}

    if (!Array.isArray(distributions) || distributions.length === 0) {
      return NextResponse.json({ error: 'Distributions array is required' }, { status: 400 });
    }

    const db = await getPool();
    const transaction = new sql.Transaction(db);
    await transaction.begin();

    try {
      const results = [];

      for (const dist of distributions) {
        const { expenseCategoryId, staffMemberId, distributionPercentage, isActive = true } = dist;

        // Validation
        if (!expenseCategoryId || expenseCategoryId <= 0 ||
            !staffMemberId || staffMemberId <= 0 ||
            !distributionPercentage || distributionPercentage <= 0 || distributionPercentage > 100) {
          throw new Error(`Invalid distribution data for category ${expenseCategoryId}, staff ${staffMemberId}`);
        }

        // Check if exists
        const existingResult = await new sql.Request(transaction)
          .input('expenseCategoryId', sql.Int, expenseCategoryId)
          .input('staffMemberId', sql.Int, staffMemberId)
          .query(`
            SELECT ID FROM [dbo].[TblStaffExpenseDistribution]
            WHERE ExpenseCategoryID = @expenseCategoryId AND StaffMemberID = @staffMemberId
          `);

        if (existingResult.recordset.length > 0) {
          // Update
          await new sql.Request(transaction)
            .input('expenseCategoryId', sql.Int, expenseCategoryId)
            .input('staffMemberId', sql.Int, staffMemberId)
            .input('distributionPercentage', sql.Decimal(5, 2), distributionPercentage)
            .input('isActive', sql.Bit, isActive)
            .query(`
              UPDATE [dbo].[TblStaffExpenseDistribution]
              SET DistributionPercentage = @distributionPercentage,
                  IsActive = @isActive,
                  ModifiedDate = GETDATE()
              WHERE ExpenseCategoryID = @expenseCategoryId AND StaffMemberID = @staffMemberId
            `);
          
          results.push({ expenseCategoryId, staffMemberId, action: 'updated' });
        } else {
          // Create
          await new sql.Request(transaction)
            .input('expenseCategoryId', sql.Int, expenseCategoryId)
            .input('staffMemberId', sql.Int, staffMemberId)
            .input('distributionPercentage', sql.Decimal(5, 2), distributionPercentage)
            .input('isActive', sql.Bit, isActive)
            .query(`
              INSERT INTO [dbo].[TblStaffExpenseDistribution] (
                ExpenseCategoryID, StaffMemberID, DistributionPercentage, IsActive
              ) VALUES (
                @expenseCategoryId, @staffMemberId, @distributionPercentage, @isActive
              )
            `);
          
          results.push({ expenseCategoryId, staffMemberId, action: 'created' });
        }
      }

      await transaction.commit();

      return NextResponse.json({
        message: `${results.length} distributions updated successfully`,
        results
      });
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/expenses/distribute] PUT error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/expenses/distribute - Remove a distribution
export async function DELETE(req: NextRequest) {
  try {
    const sessionUser = await getSession();
    if (!sessionUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(req.url);
    const expenseCategoryId = url.searchParams.get('expenseCategoryId');
    const staffMemberId = url.searchParams.get('staffMemberId');

    if (!expenseCategoryId || !staffMemberId) {
      return NextResponse.json({ error: 'Both expenseCategoryId and staffMemberId are required' }, { status: 400 });
    }

    const db = await getPool();

    await db.request()
      .input('expenseCategoryId', sql.Int, parseInt(expenseCategoryId))
      .input('staffMemberId', sql.Int, parseInt(staffMemberId))
      .query(`
        DELETE FROM [dbo].[TblStaffExpenseDistribution]
        WHERE ExpenseCategoryID = @expenseCategoryId AND StaffMemberID = @staffMemberId
      `);

    return NextResponse.json({
      message: 'Distribution deleted successfully'
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/expenses/distribute] DELETE error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
