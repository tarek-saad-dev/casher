export type Condition = { id: string; field: string; operator: 'gte' | 'eq' | 'false'; value: string };
export type AutomationDefinition = {
  name: string; event: string; conditions: Condition[]; logic: 'and'|'or'; delay: string;
  action: string; message: string;
};
const allowedEvents = new Set(['attendance.check_in','visit.completed','booking.cancelled','sale.completed','employee.advance']);
const numericFields = new Set(['streakDays','lateCount','visits']);
const booleanFields = new Set(['hasOpenComplaint','hasUpcomingBooking']);
const allowedDelays = new Set(['immediate','1h','1d','quiet']);
const allowedActions = new Set(['whatsapp','manager','task','reward']);
export function parseAutomationDefinition(value: unknown): AutomationDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid automation definition');
  const v = value as Record<string,unknown>;
  if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 160) throw new Error('اسم الأتمتة غير صالح');
  if (typeof v.message !== 'string' || !v.message.trim() || v.message.length > 3000) throw new Error('نص الرسالة غير صالح');
  if (typeof v.event !== 'string' || !allowedEvents.has(v.event)) throw new Error('الحدث غير مدعوم');
  if (typeof v.delay !== 'string' || !allowedDelays.has(v.delay)) throw new Error('التوقيت غير مدعوم');
  if (typeof v.action !== 'string' || !allowedActions.has(v.action)) throw new Error('الإجراء غير مدعوم');
  if (v.logic !== 'and' && v.logic !== 'or') throw new Error('طريقة جمع الشروط غير صحيحة');
  if (!Array.isArray(v.conditions) || v.conditions.length < 1 || v.conditions.length > 12) throw new Error('عدد الشروط غير صالح');
  const conditions: Condition[] = v.conditions.map((raw:unknown)=>{
    if (!raw || typeof raw !== 'object') throw new Error('شرط غير صالح');
    const c=raw as Record<string,unknown>;
    if(typeof c.id!=='string'||!c.id||c.id.length>80||typeof c.field!=='string'||typeof c.operator!=='string'||typeof c.value!=='string')throw new Error('شرط غير صالح');
    if(numericFields.has(c.field)) {
      if(c.operator!=='gte' && c.operator!=='eq')throw new Error('مقارنة غير مدعومة');
      if(!/^\d{1,5}$/.test(c.value))throw new Error('قيمة عددية غير صحيحة');
    } else if(booleanFields.has(c.field)) {
      if(c.operator!=='false')throw new Error('الشرط المنطقي غير صالح');
    } else throw new Error('حقل غير معروف');
    return {id:c.id,field:c.field,operator:c.operator as Condition['operator'],value:c.value};
  });
  if(new Set(conditions.map(x=>x.id)).size!==conditions.length)throw new Error('معرّفات شروط مكررة');
  return {name:v.name.trim(),message:v.message.trim(),event:v.event,delay:v.delay,action:v.action,logic:v.logic,conditions};
}
export function simulateAutomation(def:AutomationDefinition, facts: Record<string,unknown>) {
 const results=def.conditions.map(c=>{
   const raw=facts[c.field];
   const match=c.operator==='false'?raw===false:c.operator==='eq'?typeof raw==='number'&&raw===Number(c.value):typeof raw==='number'&&raw>=Number(c.value);
   return {conditionId:c.id,matched:match};
 });
 return {eligible:def.logic==='and'?results.every(r=>r.matched):results.some(r=>r.matched),results,willSend:false,mode:'dry_run' as const};
}
