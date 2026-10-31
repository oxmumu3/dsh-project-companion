import {registerGoalJSONRoute} from './workspace-access-route.js';
const keys={status:[],detail:['projectId'],recognize:['expectedRevision','expectedAccessRevision','sweep'],cancel:['expectedRevision','expectedAccessRevision'],accept:['projectId','expectedRevision'],ignore:['projectId','expectedRevision'],correct:['projectId','evidenceId','targetProjectId','expectedRevision'],vision:['projectId','title','goal','constraints','expectedRevision'],conversation:['projectId','expectedRevision']};
export function createGoalBoardController({board,host,isClosed=()=>false}={}){
 return{async action(input){
  if(isClosed())throw Object.assign(Error('GOAL_CLOSED'),{code:'GOAL_CLOSED'});
  if(!input||typeof input!=='object'||Array.isArray(input)||!Object.hasOwn(keys,input.action)||Object.keys(input).some(key=>key!=='action'&&!keys[input.action].includes(key)))throw Object.assign(Error('GOAL_ARGUMENT'),{code:'GOAL_ARGUMENT'});
  const{action,...args}=input;
  return action==='recognize'?board.startRecognition(args):action==='cancel'?board.cancelRecognition(args):action==='conversation'?board.conversation(args,{create:host.create,verify:host.verify}):action==='status'?board.status():board[action](args);
 }};
}
export const registerGoalBoardRoute=(ctx,controller)=>registerGoalJSONRoute(ctx,{path:'/api/project_companion/goals',controller});
