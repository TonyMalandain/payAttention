// Data shapes shared by core and its callers (interfaces.md §2, made exact). JSDoc only.

/** @typedef {'needs-action'|'accepted'|'declined'|'tentative'|'delegated'|'other'} PartStat */
/** @typedef {'individual'|'group'|'resource'|'room'|'unknown'} CuType */
/** @typedef {{email:string,name:string,partstat:PartStat,cutype:CuType,role:'chair'|'req-participant'|'opt-participant'|'non-participant'|'other'}} Attendee */
/** @typedef {{sourceUid:string,uid:string,recurrenceId:number|null,recurring:boolean,start:number,end:number,allDay:boolean,
 *   summary:string,location:string,description:string,conferenceUris:string[],
 *   status:'confirmed'|'tentative'|'cancelled'|'none',transparency:'opaque'|'transparent'|'unknown',
 *   organizer:{email:string,name:string}|null,attendees:Attendee[]}} OccurrenceDTO */
/** @typedef {{uid:string,name:string,backend:string,ownerEmail:string|null,ok:boolean,error:string|null,
 *   remote?:boolean|null,connection?:string|null}} SourceInfo   remote/connection: optional, D-013 (interfaces.md addendum) */
/** @typedef {{type:'snapshot',protocol:1,generatedAt:number,rangeStart:number,rangeEnd:number,sources:SourceInfo[],events:OccurrenceDTO[]}} Snapshot */

/** Settings: camelCase of the GSettings keys. Same object feeds judge() and timingFromSettings().
 * @typedef {{onlineHeadsupMinutes:number,onlineNudgeMinutes:number,onlineInsistMinutes:number,onlineTakeoverMinutes:number,
 *   inpersonHeadsupMinutes:number,inpersonNudgeMinutes:number,inpersonInsistMinutes:number,inpersonTakeoverMinutes:number,
 *   defaultTravelMinutes:number,headsupDisplaySeconds:number,snoozeMinutes:number,takeoverSnoozeMinutes:number,cutoffMinutes:number,
 *   largeMeetingSize:number,extraImportantWords:string[],extraIgnoreWords:string[],ownerDomains:string[],extraOwnerAddresses:string[],
 *   soundEnabled:boolean}} Settings */

/** judge() reads only these fields of Settings.
 * @typedef {{extraImportantWords:string[],extraIgnoreWords:string[],extraOwnerAddresses:string[],ownerDomains:string[],
 *   largeMeetingSize:number,defaultTravelMinutes:number}} JudgeConfig */

/** @typedef {{verdict:Record<string,string>,mode:Record<string,string>}} Overrides   keys: 'occ:…' or 'series:…'; values 'must'|'ignore' / 'online'|'in-person' (others ignored) */
/** @typedef {Record<string,number>} TravelTimes   place key -> minutes */

/** @typedef {'override-must'|'override-ignore'|'cancelled'|'declined'|'not-invited'|'all-day'|'free'|'ignore-word'|
 *   'important-word'|'organizer'|'external'|'no-guests'|'large'|'small'|'maybe'|'insufficient-data'|'test'} ReasonCode */

/** @typedef {{key:string,seriesKey:string,recurring:boolean,title:string,start:number|null,end:number|null,allDay:boolean,
 *   verdict:'must'|'ignore',reason:string,reasonCode:ReasonCode,verdictOverridden:boolean,
 *   mode:'online'|'in-person',modeOverridden:boolean,joinUrl:string|null,
 *   placeText:string,placeKey:string|null,travelMinutes:number|null,travelIsDefault:boolean,
 *   deadline:number|null}} JudgedOccurrence */

/** @typedef {{headsUpMs:number,nudgeMs:number,insistMs:number,takeoverMs:number}} StepOffsets   ms BEFORE the deadline */
/** @typedef {{online:StepOffsets,inPerson:StepOffsets,headsUpDisplayMs:number,snoozeMs:number,takeoverSnoozeMs:number,cutoffMs:number}} Timing */

/** @typedef {{start:number,done:null|'ack'|'skip',doneAt:number|null,snoozeUntil:number|null,headsUpShownAt:number|null}} AlertItem */
/** @typedef {{v:1,items:Record<string,AlertItem>}} AlertState      exactly data.md "Alert state" */

/** @typedef {{userActive:boolean,dataHealthy:boolean}} PlanEnv */
/** @typedef {{key:string,start:number,step:1|2|3|4,visible:boolean,deadline:number,msToDeadline:number,
 *   snoozeUntil:number,recordHeadsUpShown:boolean}} Card     snoozeUntil = when a snooze taken NOW would end */
/** @typedef {{key:string,step:1|2|3|4}} AlsoItem */
/** @typedef {{key:string,deadline:number,msToDeadline:number}} IndicatorTarget */
/** @typedef {{primary:Card|null,also:AlsoItem[],takeover:boolean,indicator:IndicatorTarget|null,dataHealthy:boolean}} Plan */

/** @typedef {{type:'ack'|'skip',key:string,start:number}
 *  | {type:'snooze',key:string,start:number,until:number}
 *  | {type:'headsUpShown',key:string,start:number}
 *  | {type:'prune'}} AlertAction */

/** An opaque compiled word list from words.js compileWords(). @typedef {object} WordMatcher */

export {};
