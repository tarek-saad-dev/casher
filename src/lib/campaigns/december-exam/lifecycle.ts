export type CampaignStatus='DRAFT'|'ACTIVE'|'PAUSED'|'ENDED';
export type CampaignAction='ACTIVATE'|'PAUSE'|'RESUME'|'END';
export function nextCampaignStatus(status:CampaignStatus,action:CampaignAction,withinWindow:boolean,activationReady:boolean):CampaignStatus|null{
 if(action==='PAUSE'&&status==='ACTIVE')return 'PAUSED';
 if(action==='END'&&(status==='ACTIVE'||status==='PAUSED'||status==='DRAFT'))return 'ENDED';
 if(!withinWindow||!activationReady)return null;
 if(action==='ACTIVATE'&&status==='DRAFT')return 'ACTIVE';
 if(action==='RESUME'&&status==='PAUSED')return 'ACTIVE';
 return null;
}
