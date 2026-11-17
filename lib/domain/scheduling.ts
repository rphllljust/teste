export type ScheduleWindow={startAt:string;endAt:string;timezone:string};

export function normalizeScheduleWindow(input:ScheduleWindow){
  const start=Date.parse(input.startAt),end=Date.parse(input.endAt);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw new Error('INVALID_WINDOW');
  try{new Intl.DateTimeFormat('en-US',{timeZone:input.timezone}).format();}catch{throw new Error('INVALID_TIMEZONE');}
  return {startUtc:new Date(start).toISOString(),endUtc:new Date(end).toISOString(),timezone:input.timezone};
}

export function overlaps(a:{startUtc:string;endUtc:string},b:{startUtc:string;endUtc:string}){
  return a.startUtc<b.endUtc&&a.endUtc>b.startUtc;
}