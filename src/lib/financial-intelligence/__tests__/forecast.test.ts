import { describe, expect, it } from 'vitest';
import { buildCashForecast, upcomingCommitments, type Commitment } from '../forecast';

const rent: Commitment = {
  id:1,branchId:2,title:'Rent',kind:'rent',amount:18000,
  dueDate:'2026-11-07',frequency:'monthly',endDate:null,
};
describe('financial intelligence forecasts',()=>{
  it('includes overdue obligations and partially settled commitments',()=>{
    const results=upcomingCommitments([rent],[{commitmentId:1,dueDate:'2026-11-07',amount:5000}], '2026-11-08',7);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({remaining:13000,paid:5000,overdue:true});
  });
  it('clamps month-end dates and returns to original due-day where possible',()=>{
    const obligation:Commitment={...rent,id:3,dueDate:'2026-01-31',endDate:'2026-03-31'};
    const items=upcomingCommitments([obligation],[], '2026-01-30',60);
    expect(items.map(x=>x.occurrenceDate)).toEqual(['2026-01-31','2026-02-28','2026-03-31']);
  });
  it('never repeats a one-time debt',()=>{
    const debt:Commitment={...rent,id:4,kind:'debt',dueDate:'2026-11-10',frequency:'once'};
    expect(upcomingCommitments([debt],[], '2026-11-08',60).map(x=>x.occurrenceDate)).toEqual(['2026-11-10']);
  });
  it('shows the first negative day when known cash runs out',()=>{
    const data=buildCashForecast({
      today:'2026-11-08',bookCash:1000,dailyReceiptsEstimate:100,
      dailyOperatingOutflowEstimate:200,commitments:[{...rent,dueDate:'2026-11-09',frequency:'once',amount:1500}],settlements:[],
    });
    expect(data.firstNegativeDay).toBe('2026-11-09');
    expect(data.due7).toBe(1500);
    expect(data.minimumCash30).toBeLessThan(0);
  });
  it('marks missing cash/history as incomplete rather than safe',()=>{
    const data=buildCashForecast({
      today:'2026-11-08',bookCash:null,dailyReceiptsEstimate:null,dailyOperatingOutflowEstimate:null,
      commitments:[],settlements:[],
    });
    expect(data.dataQuality).toBe('incomplete');
    expect(data.minimumCash30).toBeNull();
    expect(data.firstNegativeDay).toBeNull();
  });
});
