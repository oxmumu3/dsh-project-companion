// Shared passive projection; daily clocks must not be described as intervals.
export function projectDailySchedule(value){
 if(value.dailyTime===undefined&&value.timeZone===undefined)return{};
 if(typeof value.dailyTime!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/u.test(value.dailyTime)||typeof value.timeZone!=='string'||value.timeZone.length>100||value.everyMinutes!==1440)throw new Error('Invalid daily schedule');
 try{new Intl.DateTimeFormat('en',{timeZone:value.timeZone});}catch{throw new Error('Invalid daily schedule');}
 return{dailyTime:value.dailyTime,timeZone:value.timeZone};
}
