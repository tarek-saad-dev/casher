import { describe,it,expect } from 'vitest';
import {parseAutomationDefinition,simulateAutomation} from './draftRules';
const base={name:'streak',event:'attendance.check_in',conditions:[{id:'s',field:'streakDays',operator:'gte',value:'10'}],logic:'and',delay:'immediate',action:'whatsapp',message:'hi'};
describe('CUT Pulse draft rules',()=>{
 it('evaluates streak threshold without sending',()=>{const def=parseAutomationDefinition(base);expect(simulateAutomation(def,{streakDays:10}).eligible).toBe(true);expect(simulateAutomation(def,{streakDays:9}).eligible).toBe(false);expect(simulateAutomation(def,{streakDays:10}).willSend).toBe(false);});
 it('rejects unsupported fields',()=>{expect(()=>parseAutomationDefinition({...base,conditions:[{id:'1',field:'sql',operator:'eq',value:'2'}]})).toThrow();});
 it('supports OR with boolean guard',()=>{const def=parseAutomationDefinition({...base,logic:'or',conditions:[...base.conditions,{id:'b',field:'hasOpenComplaint',operator:'false',value:''}]});expect(simulateAutomation(def,{streakDays:2,hasOpenComplaint:false}).eligible).toBe(true);});
});
