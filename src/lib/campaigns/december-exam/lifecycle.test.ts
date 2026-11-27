import {describe,it,expect} from 'vitest';
import {nextCampaignStatus,type CampaignStatus,type CampaignAction} from './lifecycle';
describe('December campaign lifecycle',()=>{
 it('requires approved readiness and date window to activate/resume',()=>{
  for(const [status,action] of [['DRAFT','ACTIVATE'],['PAUSED','RESUME']] as const){
   expect(nextCampaignStatus(status,action,true,true)).toBe('ACTIVE');
   expect(nextCampaignStatus(status,action,false,true)).toBeNull();
   expect(nextCampaignStatus(status,action,true,false)).toBeNull();
  }
 });
 it('supports emergency pause/end without readiness',()=>{
  expect(nextCampaignStatus('ACTIVE','PAUSE',false,false)).toBe('PAUSED');
  for(const status of ['DRAFT','ACTIVE','PAUSED'] as const)expect(nextCampaignStatus(status,'END',false,false)).toBe('ENDED');
 });
 it('never reopens an ended campaign',()=>{
  for(const action of ['ACTIVATE','RESUME','PAUSE','END'] as CampaignAction[])expect(nextCampaignStatus('ENDED',action,true,true)).toBeNull();
 });
 it('does not permit other transitions',()=>{
  const denied:[CampaignStatus,CampaignAction][]=[['DRAFT','RESUME'],['DRAFT','PAUSE'],['ACTIVE','ACTIVATE'],['ACTIVE','RESUME'],['PAUSED','ACTIVATE'],['PAUSED','PAUSE']];
  for(const [status,action] of denied)expect(nextCampaignStatus(status,action,true,true)).toBeNull();
 });
});
