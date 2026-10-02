// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Tony Malandain

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
 *   soundEnabled:boolean,verdictSource:string,aiEndpoint:string,aiModel:string}} Settings */

/** judge() reads only these fields of Settings, plus `ai`, which the caller adds for AI mode (absent or null = rules mode).
 * @typedef {{extraImportantWords:string[],extraIgnoreWords:string[],extraOwnerAddresses:string[],ownerDomains:string[],
 *   largeMeetingSize:number,defaultTravelMinutes:number,ai?:AiJudgeConfig|null}} JudgeConfig */
/** @typedef {{engineTag:string,utcOffsetMinutes:number}} AiJudgeConfig   engineTag from aiEngine(); offset an integer -840..840 */
/** @typedef {Record<string,{fp:string,verdict:'must'|'ignore',reason:string}>} AiAnswers   occurrence key -> stored answer; other fields (such as `at`) ignored */
/** @typedef {{fp:string,verdict:'must'|'ignore',reason:string,at:number}} StoredAiAnswer   one item of data.md "AI answers" */
/** @typedef {{v:1,items:Readonly<Record<string,Readonly<StoredAiAnswer>>>}} StoredAiAnswers   exactly data.md "AI answers"; items is a valid AiAnswers for judge */

/** The bounded invite sent to the AI engine (interfaces.md §6.2, D-024), keys in INVITE_FIELDS order.
 * @typedef {{title:string,calendar:string,start:string,minutes:number,allDay:boolean,recurring:boolean,
 *   status:'confirmed'|'tentative'|'cancelled'|'none',busy:'busy'|'free'|'unknown',description:string,place:string,
 *   videoLink:string|null,you:{response:PartStat|'unknown',organiser:boolean},organiser:{name:string,email:string}|null,
 *   guests:{name:string,email:string,response:PartStat,role:'chair'|'required'|'optional'|'other'}[],
 *   guestsTotal:number}} Invite */

/** @typedef {{verdict:Record<string,string>,mode:Record<string,string>}} Overrides   keys: 'occ:…' or 'series:…'; values 'must'|'ignore' / 'online'|'in-person' (others ignored) */
/** @typedef {{kind:'place'|'meeting', key:string}} TravelTarget   the one travel entry an in-person meeting reads and a pick writes (ADR-0014) */
/** @typedef {{byPlace:Record<string,number>, byMeeting:Record<string,number>}} TravelTimes   travel-times / meeting-travel-times: key -> minutes */

/** @typedef {'override-must'|'override-ignore'|'cancelled'|'declined'|'not-invited'|'all-day'|'free'|'ignore-word'|
 *   'important-word'|'organizer'|'external'|'no-guests'|'large'|'small'|'maybe'|'insufficient-data'|'test'|
 *   'ai-must'|'ai-ignore'} ReasonCode */

/** @typedef {{key:string,seriesKey:string,recurring:boolean,title:string,start:number|null,end:number|null,allDay:boolean,
 *   verdict:'must'|'ignore',reason:string,reasonCode:ReasonCode,verdictOverridden:boolean,
 *   mode:'online'|'in-person',modeOverridden:boolean,joinUrl:string|null,
 *   placeText:string,placeKey:string|null,travelMinutes:number|null,travelIsDefault:boolean,
 *   travelTarget:TravelTarget|null,deadline:number|null,ruleReason?:string,aiStale?:true,aiAsk?:{fp:string,invite:Invite}}} JudgedOccurrence
 *   ruleReason only when an AI answer applies; aiStale only as true; aiAsk only when the meeting should be asked */

/** @typedef {{headsUpMs:number,nudgeMs:number,insistMs:number,takeoverMs:number}} StepOffsets   ms BEFORE the deadline */
/** @typedef {{online:StepOffsets,inPerson:StepOffsets,headsUpDisplayMs:number,snoozeMs:number,takeoverSnoozeMs:number,cutoffMs:number}} Timing */

/** @typedef {{start:number,done:null|'ack'|'skip',doneAt:number|null,snoozeUntil:number|null,headsUpShownAt:number|null}} AlertItem */
/** @typedef {{v:1,items:Record<string,AlertItem>}} AlertState      exactly data.md "Alert state" */

/** @typedef {{userActive:boolean,dataHealthy:boolean,heldHeadsUpKey:string|null}} PlanEnv
 *  heldHeadsUpKey: the occurrence whose heads-up the owner is holding on screen (its travel choices are open), or null */
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
