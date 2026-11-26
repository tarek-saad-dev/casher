/** In-memory educational simulation. No application adapters, API, storage or database. */
export const TRAINING_SERVICES = [{id:'haircut',name:'حلاقة شعر',piastres:20000},{id:'beard',name:'حلاقة ذقن',piastres:10000}] as const;
export type TrainingStep = 'customer'|'sale'|'booking'|'queue'|'treasury'|'close';
export type Payment = 'cash'|'card';
export type TrainingSale = { serviceId:string; name:string; piastres:number; payment:Payment };
export type TrainingState = { steps:TrainingStep[]; completed:TrainingStep[]; sale:TrainingSale|null; customer:boolean; booking:boolean; queue:boolean; reconciled:boolean; closed:boolean };
export type TrainingAction =
  | {step:'customer'}
  | {step:'sale';serviceId:string;payment:Payment}
  | {step:'booking'}
  | {step:'queue'}
  | {step:'treasury';countedPiastres:number}
  | {step:'close'};

export function newTraining(apps:readonly string[]):TrainingState {
  const steps:TrainingStep[]=['customer'];
  if(apps.includes('pos'))steps.push('sale');
  if(apps.includes('booking'))steps.push('booking');
  if(apps.includes('queue'))steps.push('queue');
  if(apps.includes('treasury'))steps.push('treasury');
  if(apps.includes('pos')||apps.includes('treasury'))steps.push('close');
  return {steps,completed:[],sale:null,customer:false,booking:false,queue:false,reconciled:false,closed:false};
}
export function nextTrainingStep(state:TrainingState):TrainingStep|null {
  return state.steps[state.completed.length]??null;
}
export function trainingCash(state:TrainingState):number {
  return state.sale?.payment==='cash'?state.sale.piastres:0;
}
export function applyTrainingAction(state:TrainingState,action:TrainingAction):TrainingState {
  if(nextTrainingStep(state)!==action.step||state.closed)throw new Error('كمّل خطوة التدريب الحالية أولًا.');
  const next={...state,completed:[...state.completed,action.step]};
  switch(action.step){
    case 'customer':return {...next,customer:true};
    case 'sale':{
      const service=TRAINING_SERVICES.find(x=>x.id===action.serviceId);
      if(!state.customer||!service||!['cash','card'].includes(action.payment))throw new Error('اختر خدمة وطريقة دفع صحيحة.');
      return {...next,sale:{serviceId:service.id,name:service.name,piastres:service.piastres,payment:action.payment}};
    }
    case 'booking':return {...next,booking:true};
    case 'queue':return {...next,queue:true};
    case 'treasury':
      if(!Number.isSafeInteger(action.countedPiastres)||action.countedPiastres!==trainingCash(state))throw new Error('راجع النقد الموجود في الصندوق. المدفوعات بالبطاقة لا تدخل في النقد.');
      return {...next,reconciled:true};
    case 'close':
      if(state.steps.includes('treasury')&&!state.reconciled)throw new Error('راجع الخزنة قبل قفل الوردية.');
      return {...next,closed:true};
  }
}
