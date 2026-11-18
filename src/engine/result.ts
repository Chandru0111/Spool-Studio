export type Result<T> = {ok:true;value:T}|{ok:false;message:string};
export const ok = <T>(value:T):Result<T> => ({ok:true,value});
export const err = <T>(message:string):Result<T> => ({ok:false,message});
