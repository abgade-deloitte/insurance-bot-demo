import {icon,escapeHTML as esc} from './icons.js';

const MINIMUM_AGENT_WORK_MS=6000;
const DOCUMENT_AGENT_WORK_MS=9000;
const EMPLOYMENT_VERIFICATION_MS=105000;
const RECOMMENDATION_AGENT_WORK_MS=7500;
const ANALYSIS_AGENT_WORK_MS=20000;
const POLICY_RECOMMENDATION_SEQUENCE_MS=12000;
const UNDERWRITING_HANDOFF_MS=5000;
const MEDICAL_DOCUMENT_INTELLIGENCE_MS=75000;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const workDuration=work=>Number(work?.demoDurationMs)||MINIMUM_AGENT_WORK_MS;
const workVisualStep=work=>{if(!work)return 0;if(work.documentWorkflow)return documentWorkflowProgress(work);if(work.recommendationSequence)return Number(work.sequenceIndex)||0;if((work.analysisWorkflow||work.underwritingWorkflow)&&work.customSteps?.length){const elapsed=Math.max(0,performance.now()-work.startedAt),duration=workDuration(work),step=Math.min(work.customSteps.length-1,Math.floor(elapsed/(duration/work.customSteps.length))),handoff=elapsed>=duration/2?1:0;return `${step}-${handoff}`;}if(work.customSteps?.length)return Math.min(work.customSteps.length-1,Math.floor(Math.max(0,performance.now()-work.startedAt)/(workDuration(work)/work.customSteps.length)));return Number(work.sequenceIndex)||0;};
const workRenderKey=work=>work?`${work.activityId||'work'}:${work.agentId}:${workVisualStep(work)}:${work.status}`:'';
const workspaceRenderKey=chat=>{const employment=chat.state.employmentVerification,employmentElapsed=Math.max(0,Date.now()-(employment?.startedAt||Date.now())),employmentPhase=Math.min(3,[0,32000,65000,93000].filter(value=>employmentElapsed>=value).length-1),employmentTick=employment?.status==='running'?`running-${employmentPhase}`:employment?.status||'',medical=chat.state.medicalDocumentIntelligence,medicalElapsed=Math.max(0,Date.now()-(medical?.startedAt||Date.now())),medicalPhase=Math.min(4,Math.floor(medicalElapsed/(MEDICAL_DOCUMENT_INTELLIGENCE_MS/5))),medicalTick=medical?.status==='running'?`running-${medicalPhase}`:medical?.status||'',history=activityHistory(chat).map(event=>`${event.id}:${event.status}:${event.revision||0}:${eventActiveIndex(chat,event)}`).join('|');return `${workRenderKey(chat.agentWork)}:${chat.lastAgentRun?.activityId||''}:${employmentTick}:${medicalTick}:${history}`;};
const scheduleWorkspaceProgress=(chat,token)=>{
 const run=chat.agentWork,sequence=run?.agentSequence?.length?run.agentSequence:[run?.agentId].filter(Boolean),duration=workDuration(run),segment=duration/Math.max(1,sequence.length);
 sequence.slice(1).forEach((agentId,index)=>setTimeout(()=>{if(chat.agentWorkSequence!==token||chat.agentWork?.status!=='running')return;const current=chat.agentWork,next=workDefinition(chat,agentId,current.prompt),completed=[...(current.completedAgentIds||[]),current.agentId];chat.agentWork={...next,startedAt:current.startedAt,agentStartedAt:performance.now(),hiddenFrom:current.hiddenFrom,agentSequence:sequence,sequenceIndex:index+1,completedAgentIds:[...new Set(completed)],prompt:current.prompt,nonBlocking:current.nonBlocking,demoDurationMs:current.demoDurationMs,customSteps:current.customSteps,recommendationSequence:current.recommendationSequence,activityId:current.activityId};chat.state.agentPanelStage=agentId;paintAgentWork(chat);},Math.round(segment*(index+1))));
 for(let delay=500;delay<duration;delay+=500)setTimeout(()=>{if(chat.agentWorkSequence===token)chat.refreshAgentWorkspace?.();},delay);
};

const agents=[
 {id:1,key:'advisor',icon:'chat',name:'Advisor Agent',short:'Advisor',ar:'وكيل الاستشارة',purpose:'Understands intent and routes the conversation.',purposeAr:'يفهم الهدف ويوجه المحادثة.'},
 {id:2,key:'identity',icon:'file',name:'Document Scanning & Validation Agent',short:'Documents',ar:'وكيل مسح المستندات والتحقق منها',purpose:'Extracts available fields and validates identity and mobile formats.',purposeAr:'يستخرج الحقول المتاحة ويتحقق من صيغ الهوية والجوال.'},
 {id:3,key:'application',icon:'user',name:'Application Agent',short:'Application',ar:'وكيل الطلب',purpose:'Collects only the information still required.',purposeAr:'يجمع فقط المعلومات المطلوبة المتبقية.'},
 {id:4,key:'pricing',icon:'sliders',name:'Underwriting & Pricing Agent',short:'Pricing',ar:'وكيل الاكتتاب والتسعير',purpose:'Assesses cover, eligibility and premium scenarios.',purposeAr:'يقيّم التغطية والأهلية وسيناريوهات القسط.'},
 {id:5,key:'recommendation',icon:'spark',name:'Recommendation Agent',short:'Recommendation',ar:'وكيل التوصيات',purpose:'Explains the best-fit plans and optional benefits.',purposeAr:'يشرح الخطط الأنسب والمنافع الاختيارية.'},
 {id:6,key:'issuance',icon:'shield',name:'Payment & Issuance Agent',short:'Issuance',ar:'وكيل الدفع والإصدار',purpose:'Prepares secure payment and policy issuance.',purposeAr:'يجهز الدفع الآمن وإصدار الوثيقة.'}
];

const documentWorkflowAgents=[
 {key:'scan',icon:'file',name:'Document Scanning Agent',detail:'Reads the uploaded file and extracts visible fields.'},
 {key:'identity',icon:'user',name:'Identity Agent',detail:'Recognises the evidence as a National ID or Iqama.'},
 {key:'validation',icon:'shield',name:'Validation Agent',detail:'Applies identity, mobile and document-format rules.'},
 {key:'underwriting',icon:'sliders',name:'Underwriting Agent',detail:'Accepts the validated handoff and prefills the application.'}
];

const activityHistory=chat=>chat.state.agentActivityHistory||(chat.state.agentActivityHistory=[]);
function beginActivity(chat,work,{type='orchestration',title}={}){
 const history=activityHistory(chat),now=Date.now(),backgroundTypes=new Set(['employment','medical-document']);if(!backgroundTypes.has(type))history.filter(item=>item.status==='running'&&!backgroundTypes.has(item.type)).forEach(item=>{item.status='complete';item.completedAt=now;item.durationMs=Math.max(0,now-item.startedAt);});
 const id=`activity-${now}-${Math.random().toString(36).slice(2,7)}`,event={id,type,title:title||work.title,prompt:work.prompt||'',status:'running',startedAt:now,primaryAgentId:work.agentId,agentSequence:[...(work.agentSequence||[work.agentId])],documentWorkflow:Boolean(work.documentWorkflow)};
 activityHistory(chat).push(event);chat.state.agentActivityHistory=activityHistory(chat).slice(-12);work.activityId=id;return event;
}
function completeActivity(chat,run){
 const event=activityHistory(chat).find(item=>item.id===run?.activityId);if(!event)return;event.status='complete';event.completedAt=Date.now();event.durationMs=run.durationMs||Math.max(0,event.completedAt-event.startedAt);
}

function ageRisk(age){
 const value=Number(age);if(!Number.isFinite(value)||value<=0)return {label:'Age Risk',level:'review',value:'Review',detail:'Age was not available for this planning signal.'};
 if(value>=53)return {label:'Age Risk',level:'high',value:'High',detail:`Age ${value} is above 52 and is flagged for enhanced underwriting review.`};
 if(value>=40)return {label:'Age Risk',level:'medium',value:'Medium',detail:`Age ${value} is within the 40–52 medium planning-risk range.`};
 if(value>=25)return {label:'Age Risk',level:'low',value:'Low',detail:`Age ${value} is within the 25–39 low planning-risk range.`};
 return {label:'Age Risk',level:'medium',value:'Medium',detail:`Age ${value} is below the configured 25–39 low-risk band and needs review.`};
}
function riskSignalMarkup(chat,risk){if(!risk)return '';return `<div class="agent-risk-signal ${esc(risk.level)}"><span>${icon(risk.level==='low'?'check':risk.level==='high'?'info':'shield')}</span><div><small>${esc(copy(chat,risk.label,risk.label))}</small><strong>${esc(risk.value)}</strong><p>${esc(risk.detail||'')}</p></div></div>`;}
function metricMarkup(event){const metrics=event?.metrics||[];if(!metrics.length)return '';return `<div class="agent-result-metrics">${metrics.map(item=>`<div><small>${esc(item.label)}</small><strong>${esc(String(item.value))}</strong></div>`).join('')}</div>`;}
function formulaMarkup(event){const formulae=event?.formulae||[];if(!formulae.length)return '';return `<div class="agent-formula-panel"><div class="agent-formula-title">${icon('sliders')}<span><small>CALCULATION TRACE</small><strong>Formulae used by the Analysis Agent</strong></span></div>${formulae.map(item=>`<div class="agent-formula-row"><code>${esc(item.formula)}</code><strong>${esc(item.result)}</strong></div>`).join('')}</div>`;}
function recommendationResultMarkup(chat,event){const results=event?.recommendationResults||[];if(event?.status!=='complete'||!results.length)return '';return `<section class="agent-recommendation-results"><div class="recommendation-results-heading">${icon('check')}<span><small>${copy(chat,'COMPLETED RECOMMENDATION','اكتملت التوصية')}</small><strong>${copy(chat,'Policy results','نتائج الوثائق')}</strong></span></div><div class="recommendation-result-grid">${results.map((result,index)=>`<article class="${index===0?'recommended':'seller'}"><small>${esc(result.label)}</small><strong>${esc(result.name)}</strong><span>${esc(result.detail||'')}</span></article>`).join('')}</div></section>`;}

const copy=(chat,en,ar)=>chat.state.lang==='ar'?ar:en;
const flowStage=chat=>chat.state.purchaseFlow?.stage||'';
const isPayment=stage=>['payment-ready','payment-demo','complete'].includes(stage);

function journeyStage(chat){
 const state=chat.state,flow=flowStage(chat),document=state.agentDocumentCheck;
 if(document&&['scanning','invalid'].includes(document.status)&&(['login','register','customer-profile'].includes(state.stage)||flow==='capture'||(!flow&&state.stage!=='explore')))return 2;
 if(isPayment(flow))return 6;
 if(flow==='purchase')return 4;
 if(['addons','selected','review'].includes(flow))return 5;
 if(['catalogue','recommendations','plans','options','life-intro','calculator','choose','renewal-details'].includes(flow))return 4;
 if(flow==='capture'||state.stage==='customer-profile')return 3;
 if(['login','register'].includes(state.stage))return 2;
 return 1;
}

function activeStage(chat){return chat.agentWork?.status==='running'?chat.agentWork.agentId:chat.lastAgentRun?.agentId||journeyStage(chat);}
function participatedAgents(chat){return new Set([...(chat.state.agentRunHistory||[]),...(chat.agentWork?.completedAgentIds||[]),...(chat.lastAgentRun?.agentSequence||[])]);}
function statusFor(chat,id,active){return chat.agentWork?.status==='running'&&id===active?'running':participatedAgents(chat).has(id)?'complete':'waiting';}
function statusLabel(chat,status){return copy(chat,{complete:'Complete',running:'Active',waiting:'Standby'}[status],{complete:'مكتمل',running:'نشط',waiting:'جاهز'}[status]);}

function intentLabel(chat){
 const state=chat.state,flow=state.purchaseFlow||{},goal=flow.lifeGoal||state.profile?.goal,category=flow.category||state.profile?.category;
 if(flow.renewal||state.existingIntent==='renew')return copy(chat,'Policy renewal','تجديد الوثيقة');
 if(category==='motor')return copy(chat,'Motor Insurance','تأمين المركبات');
 if(goal==='education')return copy(chat,'Education planning','التخطيط للتعليم');
 if(goal==='combined')return copy(chat,'Protection and savings','الحماية والادخار');
 if(category==='life'||goal==='protect')return copy(chat,'Family protection','حماية الأسرة');
 return copy(chat,'Listening for customer intent','الاستماع لهدف العميل');
}

function knownFields(chat){
 const profile=chat.state.profile||{};
 return ['fullName','age','gender','monthlyIncome','occupation','city','dependants','goal','coverage','budget'].filter(key=>profile[key]!==undefined&&profile[key]!==null&&profile[key]!=='').length;
}

function workDefinition(chat,agentId,text=''){
 const agent=agents[agentId-1]||agents[0],definitions={
  1:{title:['Understanding your request','فهم طلبك'],detail:['Reading your message and choosing the right journey.','قراءة رسالتك واختيار الرحلة المناسبة.'],phases:[['Understanding your question','فهم سؤالك'],['Detecting intent and context','تحديد الهدف والسياق'],['Preparing the next best step','إعداد أفضل خطوة تالية']]},
  2:{title:['Checking identity and documents','التحقق من الهوية والمستندات'],detail:['Reviewing the available evidence and validation rules.','مراجعة الأدلة المتاحة وقواعد التحقق.'],phases:[['Reading document details','قراءة تفاصيل المستند'],['Validating identity format','التحقق من صيغة الهوية'],['Preparing a secure result','إعداد نتيجة آمنة']]},
  3:{title:['Preparing your application','إعداد طلبك'],detail:['Checking the customer details needed for a suitable recommendation.','التحقق من بيانات العميل المطلوبة لتوصية مناسبة.'],phases:[['Reviewing shared details','مراجعة البيانات المشتركة'],['Finding missing information','تحديد المعلومات الناقصة'],['Building your application profile','إعداد ملف الطلب']]},
  4:{title:['Assessing policies and pricing','تقييم الوثائق والتسعير'],detail:['Comparing suitable cover and premium scenarios.','مقارنة سيناريوهات التغطية والقسط المناسبة.'],phases:[['Searching relevant policies','البحث عن الوثائق المناسبة'],['Comparing cover and premium','مقارنة التغطية والقسط'],['Checking affordability and fit','التحقق من القدرة المالية والملاءمة']]},
  5:{title:['Preparing the Himaya recommendation','إعداد توصية حماية'],detail:['Reviewing plan fit, trade-offs and optional benefits.','مراجعة ملاءمة الخطة والمفاضلات والمنافع الاختيارية.'],phases:[['Reviewing suitability','مراجعة الملاءمة'],['Ranking the strongest options','ترتيب أقوى الخيارات'],['Explaining why it fits','شرح سبب الملاءمة']]},
  6:{title:['Preparing the secure handoff','إعداد الانتقال الآمن'],detail:['Finalising the payment and policy issuance steps.','إنهاء خطوات الدفع وإصدار الوثيقة.'],phases:[['Checking final selections','التحقق من الاختيارات النهائية'],['Preparing payment handoff','إعداد الانتقال للدفع'],['Ready for policy issuance','جاهز لإصدار الوثيقة']]}
 };
 const definition=definitions[agent.id];
 return {agentId:agent.id,status:'running',startedAt:performance.now(),agentStartedAt:performance.now(),hiddenFrom:chat.state.messages?.length||0,title:copy(chat,...definition.title),detail:copy(chat,...definition.detail),phases:definition.phases.map(phase=>copy(chat,...phase)),prompt:text};
}

function orchestrationForMessage(chat,text){
 const value=String(text||'').toLowerCase(),flow=flowStage(chat);
 if(/document|upload|national id|iqama|identity|هوية|مستند/.test(value))return [2];
 if(/payment|pay|issue|checkout|دفع|إصدار/.test(value)||isPayment(flow))return [6];
 if(chat.state.stage==='customer-profile'||flow==='capture')return [3];
 if(['login','register'].includes(chat.state.stage))return [2];
 if(/update|change|correct|edit/.test(value)&&/profile|details|salary|income|occupation|city|dependants?|بيانات|راتب|دخل|مهنة|مدينة|معال/.test(value))return [3];
 const explanatory=/\b(?:what is|what are|explain|how does|how do|meaning of|tell me about|learn about)\b|(?:ما هو|ما هي|اشرح|كيف يعمل|ماذا يعني)/.test(value),decisionLanguage=/plans?|polic(?:y|ies)|options?|recommend|best|top seller|compare|buy|quote|خطط|وثائق|خيارات|توص|أفضل|شراء|عرض سعر/.test(value);
 if(explanatory&&!decisionLanguage)return [1];
 const pricingOnly=/calculat|premium|price|quote|coverage amount|how much|قسط|سعر|عرض سعر|حساب/.test(value)&&!/plans?|polic(?:y|ies)|options?|recommend|best|top seller|خطط|وثائق|خيارات|توص|أفضل/.test(value);
 if(pricingOnly||flow==='calculator')return [4,5];
 const planDiscovery=/plans?|polic(?:y|ies)|options?|insurance|recommend|best fit|top seller|compare|motor|life|education|family|وثيقة|خطط|خيارات|تأمين|توص|أفضل|مركبات|حياة|تعليم|أسرة/.test(value)||(['catalogue','recommendations','plans','options','life-intro','renewal-details'].includes(flow)&&/which one|cheapest|lowest|popular|suitable|show more|الأرخص|الأقل|الأكثر شعبية|أنسب/.test(value));
 if(planDiscovery)return [5,4,5];
 if(['addons','selected','review','purchase'].includes(flow)||/benefit|add.on|منافع/.test(value))return [5,4,5];
 return [1];
}

function orchestratedWork(chat,sequence,text=''){const resolved=[...new Set((sequence||[]).filter(id=>agents[id-1]))],ordered=resolved.length?sequence.filter(id=>agents[id-1]):[1],work=workDefinition(chat,ordered[0],text);return {...work,agentSequence:ordered,sequenceIndex:0,completedAgentIds:[]};}
function rememberAgentRun(chat,run){const participated=run?.agentSequence?.length?run.agentSequence:[run?.agentId].filter(Boolean);chat.state.agentRunHistory=[...new Set([...(chat.state.agentRunHistory||[]),...participated])];}

function selectionTransition(event){
 const target=event.target;
 const lifeGoal=target.closest('[data-life-goal]');if(lifeGoal)return {sequence:[5,4,5],prompt:`Review ${lifeGoal.textContent.replace(/\s+/g,' ').trim().slice(0,90)}`};
 const policyType=target.closest('[data-policy-type]');if(policyType)return policyType.dataset.policyType==='motor'?{sequence:[5,4,5],prompt:'Explore Motor Insurance options'}:{sequence:[1],prompt:'Start the Life Insurance journey',nonBlocking:true};
 if(target.closest('[data-confirm-purchase]'))return {sequence:[6],prompt:'Prepare secure payment and policy issuance'};
 if(target.closest('[data-continue-buy],[data-personalized-buy]'))return {sequence:[3],prompt:'Prepare the customer application details',nonBlocking:true};
 const catalogueFilter=target.closest('[data-catalogue-filter]');
 if(catalogueFilter){const labels={all:'All Life Insurance policies',protect:'Family protection policies',combined:'Protection and savings policies',education:'Education planning policies'};return {sequence:[5,4,5],prompt:labels[catalogueFilter.dataset.catalogueFilter]||'Life Insurance policies'};}
 const reply=target.closest('[data-reply-option]');if(reply)return {sequence:[5,4,5],prompt:`Review ${reply.dataset.replyOption||reply.textContent.trim()}`};
 const plan=target.closest('[data-synthetic-plan]');if(plan)return null;
 return null;
}

function agentSteps(chat,agent,status){
 const state=chat.state,flow=state.purchaseFlow||{},document=state.agentDocumentCheck,live=chat.agentWork?.status==='running'&&chat.agentWork.agentId===agent.id;
 if(live)return chat.agentWork.phases.map((label,index)=>({label,state:index===0?'done':index===1?'live':'queued'}));
 const details={
  advisor:[copy(chat,`Intent signal: ${intentLabel(chat)}`,`إشارة الهدف: ${intentLabel(chat)}`),copy(chat,'Routing the conversation to the right specialist','توجيه المحادثة إلى الوكيل المناسب'),copy(chat,'Keeping free text and guided options aligned','مواءمة النص الحر والخيارات الموجهة')],
  identity:[document?copy(chat,document.message,document.messageAr):copy(chat,'Waiting for identity evidence or account sign-in','بانتظار مستند الهوية أو تسجيل الدخول'),copy(chat,state.authenticated?'ART customer account matched':'Checking identity and consent fields',state.authenticated?'تمت مطابقة حساب عميل ART':'التحقق من حقول الهوية والموافقة'),copy(chat,'Sensitive values remain masked','تبقى القيم الحساسة مخفية')],
  application:[copy(chat,`${knownFields(chat)} planning fields available`,`تتوفر ${knownFields(chat)} حقول للتخطيط`),copy(chat,'Finding only the information still missing','تحديد المعلومات الناقصة فقط'),copy(chat,'Preparing a consistent application record','إعداد سجل طلب متسق')],
  pricing:[copy(chat,'Evaluating suitability across available plans','تقييم الملاءمة عبر الخطط المتاحة'),copy(chat,flow.estimate?'Recalculating selected cover and premium':'Preparing cover and premium scenarios',flow.estimate?'إعادة حساب التغطية والقسط المختارين':'إعداد سيناريوهات التغطية والقسط'),copy(chat,'Routing exceptions for human review','تحويل الاستثناءات للمراجعة البشرية')],
  recommendation:[copy(chat,flow.syntheticPolicy?.name?`Selected: ${flow.syntheticPolicy.name}`:'Comparing relevant policy options',flow.syntheticPolicy?.name?`المحدد: ${flow.syntheticPolicy.name}`:'مقارنة خيارات الوثائق المناسبة'),copy(chat,`${(flow.addOns||[]).length} optional benefits selected`,`تم اختيار ${(flow.addOns||[]).length} منافع اختيارية`),copy(chat,'Explaining fit, value and trade-offs','شرح الملاءمة والقيمة والمفاضلات')],
  issuance:[copy(chat,flow.contactSummary?'Customer details ready for final review':'Waiting for verified purchase details',flow.contactSummary?'بيانات العميل جاهزة للمراجعة النهائية':'بانتظار بيانات شراء موثقة'),copy(chat,isPayment(flowStage(chat))?'Secure payment handoff prepared':'Payment connection remains protected',isPayment(flowStage(chat))?'تم تجهيز الانتقال الآمن للدفع':'اتصال الدفع محمي'),copy(chat,'Policy issuance follows approved payment','يتم إصدار الوثيقة بعد الدفع المعتمد')]
 }[agent.key];
 return details.map((label,index)=>({label,state:status==='complete'?'done':status==='waiting'?'queued':index===0?'done':index===1?'live':'queued'}));
}

function latestPrompt(chat,run){
 if(run?.prompt?.trim())return run.prompt.trim();
 const message=[...(chat.state.messages||[])].reverse().find(item=>item.role==='user');
 return message?.raw||intentLabel(chat);
}

function documentWorkflowProgress(run){
 const elapsed=run?.status==='complete'?DOCUMENT_AGENT_WORK_MS:Math.max(0,performance.now()-(run?.startedAt||performance.now()));
 return Math.min(documentWorkflowAgents.length-1,Math.floor(elapsed/(DOCUMENT_AGENT_WORK_MS/documentWorkflowAgents.length)));
}

function documentExecutionSteps(chat,run){
 const active=documentWorkflowProgress(run),complete=run?.status==='complete';
 return documentWorkflowAgents.map((agent,index)=>({title:agent.name,detail:index===0?copy(chat,'Scanning the uploaded document and extracting available fields.','مسح المستند المرفوع واستخراج الحقول المتاحة.'):index===1?copy(chat,'Classifying the evidence as a National ID or Iqama.','تصنيف الإثبات كهوية وطنية أو إقامة.'):index===2?copy(chat,'Checking document, identity and mobile validation rules.','التحقق من قواعد المستند والهوية ورقم الجوال.'):copy(chat,'Receiving the validated handoff and prefilling the application.','استلام التحويل الموثق وتعبئة الطلب مسبقاً.'),state:complete||index<active?'done':index===active?'live':'queued'}));
}

function executionSteps(chat,agent,run){
 if(run?.documentWorkflow)return documentExecutionSteps(chat,run);
 if(run?.customSteps)return run.customSteps.map(step=>({title:step.title,detail:step.detail}));
 const state=chat.state,flow=state.purchaseFlow||{},profile=state.profile||{},document=state.agentDocumentCheck,category=flow.category||profile.category||copy(chat,'insurance','التأمين'),promptText=String(run?.prompt||''),detectedGoal=/motor|car|vehicle|مركب|سيار/i.test(promptText)?copy(chat,'Motor Insurance','تأمين المركبات'):/education|school|child|تعليم|دراس/i.test(promptText)?copy(chat,'Education planning','التخطيط للتعليم'):/life|family|protect|حياة|أسرة|حما/i.test(promptText)?copy(chat,'Family protection','حماية الأسرة'):null,goal=detectedGoal||intentLabel(chat),messageCount=(state.messages||[]).length,known=knownFields(chat);
 const context=state.authenticated?copy(chat,'Existing ART customer context loaded with consent','تم تحميل سياق عميل ART الحالي بموافقته'):state.registered?copy(chat,`${known} customer profile fields available for this session`,`يتوفر ${known} حقلاً لملف العميل في هذه الجلسة`):copy(chat,'Guest session · no personal data loaded','جلسة ضيف · لم يتم تحميل بيانات شخصية');
 const common=[
  {title:copy(chat,'Understanding your request','فهم طلبك'),detail:copy(chat,`Intent identified: ${goal}`,`تم تحديد الهدف: ${goal}`)},
  {title:copy(chat,'Loading customer context','تحميل سياق العميل'),detail:context},
  {title:copy(chat,'Conversation memory','ذاكرة المحادثة'),detail:copy(chat,`${messageCount} messages available in this chat`,`${messageCount} رسائل متاحة في هذه المحادثة`)},
  {title:copy(chat,`Routing to ${agent.name}`,`التوجيه إلى ${agent.ar}`),detail:copy(chat,`${agent.name} selected for this task`,`${agent.ar} هو الأنسب لهذه المهمة`)}
 ];
 const specific={
  advisor:[
   {title:copy(chat,'Classifying insurance intent','تصنيف هدف التأمين'),detail:copy(chat,'Detecting product, goal and requested action','تحديد المنتج والهدف والإجراء المطلوب')},
   {title:copy(chat,'Selecting the customer journey','اختيار رحلة العميل'),detail:copy(chat,'Matching free text to the safest relevant path','مطابقة النص الحر مع المسار الأنسب والأكثر أماناً')},
   {title:copy(chat,'Preparing guided next steps','إعداد الخطوات التالية'),detail:copy(chat,'Keeping conversation and clickable options aligned','مواءمة المحادثة والخيارات القابلة للنقر')}
  ],
  identity:[
   {title:copy(chat,'Reading identity evidence','قراءة إثبات الهوية'),detail:document?.fileName||copy(chat,'Waiting for National ID, Iqama or account sign-in','بانتظار الهوية الوطنية أو الإقامة أو تسجيل الدخول')},
   {title:copy(chat,'Validating Saudi identity format','التحقق من صيغة الهوية السعودية'),detail:document?copy(chat,document.message,document.messageAr):copy(chat,'Applying National ID and Iqama validation rules','تطبيق قواعد التحقق من الهوية الوطنية والإقامة')},
   {title:copy(chat,'Protecting sensitive values','حماية القيم الحساسة'),detail:copy(chat,'Identity and contact values remain masked','تبقى قيم الهوية والاتصال مخفية')}
  ],
  application:[
   {title:copy(chat,'Checking required application fields','التحقق من حقول الطلب المطلوبة'),detail:copy(chat,`${known} planning fields are currently available`,`يتوفر حالياً ${known} حقلاً للتخطيط`)},
   {title:copy(chat,'Identifying missing information','تحديد المعلومات الناقصة'),detail:copy(chat,'Requesting only details that affect suitability','طلب البيانات التي تؤثر في الملاءمة فقط')},
   {title:copy(chat,'Building a consistent profile','إعداد ملف متسق'),detail:copy(chat,'Normalising income, dependants, occupation and cover','توحيد الدخل والمعالين والمهنة والتغطية')}
  ],
  pricing:[
   {title:copy(chat,'Searching the policy catalogue','البحث في كتالوج الوثائق'),detail:copy(chat,`${category} plans matched to the current goal`, `تمت مطابقة خطط ${category} مع الهدف الحالي`)},
   {title:copy(chat,'Applying suitability rules','تطبيق قواعد الملاءمة'),detail:copy(chat,'Checking age, city, occupation, dependants and existing cover when available','التحقق من العمر والمدينة والمهنة والمعالين والتغطية الحالية عند توفرها')},
   {title:copy(chat,'Calculating cover and premium','حساب التغطية والقسط'),detail:copy(chat,profile.coverage?`${Number(profile.coverage).toLocaleString('en-SA')} SAR cover · ${profile.budget||'editable'} SAR budget`:'Preparing editable coverage and premium scenarios',profile.coverage?`تغطية ${Number(profile.coverage).toLocaleString('ar-SA')} ر.س · ميزانية ${profile.budget||'قابلة للتعديل'} ر.س`:'إعداد سيناريوهات قابلة للتعديل للتغطية والقسط')},
   {title:copy(chat,'Comparing plan value','مقارنة قيمة الخطط'),detail:copy(chat,'Reviewing premium, cover, popularity and benefit trade-offs','مراجعة القسط والتغطية والشعبية ومفاضلات المنافع')}
  ],
  recommendation:[
   {title:copy(chat,'Reviewing shortlisted policies','مراجعة الوثائق المختصرة'),detail:flow.syntheticPolicy?.name||copy(chat,'Comparing the leading policy matches','مقارنة أفضل الوثائق المطابقة')},
   {title:copy(chat,'Ranking the Himaya recommendation','ترتيب توصية حماية'),detail:copy(chat,'Balancing protection fit, affordability and customer priorities','موازنة ملاءمة الحماية والقدرة المالية وأولويات العميل')},
   {title:copy(chat,'Checking optional benefits','التحقق من المنافع الاختيارية'),detail:copy(chat,`${(flow.addOns||[]).length} paid benefits currently selected`,`تم اختيار ${(flow.addOns||[]).length} منافع مدفوعة حالياً`)},
   {title:copy(chat,'Explaining why it fits','شرح سبب الملاءمة'),detail:copy(chat,'Preparing concise reasons, trade-offs and next actions','إعداد أسباب موجزة ومفاضلات وإجراءات تالية')}
  ],
  issuance:[
   {title:copy(chat,'Reviewing the purchase summary','مراجعة ملخص الشراء'),detail:copy(chat,'Checking selected policy, benefits and customer details','التحقق من الوثيقة والمنافع وبيانات العميل')},
   {title:copy(chat,'Preparing the payment handoff','إعداد الانتقال للدفع'),detail:copy(chat,'Creating a protected transition without exposing payment data','إنشاء انتقال محمي دون كشف بيانات الدفع')},
   {title:copy(chat,'Queuing policy issuance','إدراج إصدار الوثيقة'),detail:copy(chat,'Issuance begins only after approved payment confirmation','يبدأ الإصدار فقط بعد تأكيد الدفع المعتمد')}
  ]
 }[agent.key];
 return [...common,...specific,{title:copy(chat,'Preparing the customer response','إعداد رد العميل'),detail:run?.status==='complete'?copy(chat,'Response delivered to the conversation','تم إرسال الرد إلى المحادثة'):copy(chat,'Formatting the next response and available actions','تنسيق الرد التالي والإجراءات المتاحة')}];
}

function timelineState(run,index,total){
 if(run?.documentWorkflow)return documentExecutionSteps({state:{lang:'en'}},run)[index]?.state||'queued';
 if(run?.status==='complete')return 'done';
 if(run?.status!=='running')return index===0?'live':'queued';
 const sequenceLength=Math.max(1,run.agentSequence?.length||1),agentDuration=workDuration(run)/sequenceLength,elapsed=Math.max(0,performance.now()-(run.agentStartedAt||run.startedAt)),progress=Math.min(total-1,Math.floor(elapsed/(agentDuration/Math.max(1,total-1))));
 return index<progress?'done':index===progress?'live':'queued';
}

function journeyNarrative(chat){
 const state=chat.state,flow=state.purchaseFlow||{},renewal=state.existingIntent==='renew'||flow.renewal,life=flow.category==='life'||state.profile?.category==='life'||['life-intro','plans','catalogue','recommendations','addons','calculator'].includes(flow.stage),motor=flow.category==='motor'||state.profile?.category==='motor';
 if(state.stage==='login')return {icon:'lock',eyebrow:copy(chat,'SECURE CUSTOMER ACCESS','وصول آمن للعميل'),title:copy(chat,renewal?'Existing customer signing in to renew a policy':'Existing customer signing in to buy a new policy',renewal?'عميل حالي يسجل الدخول لتجديد وثيقته':'عميل حالي يسجل الدخول لشراء وثيقة جديدة'),description:copy(chat,state.loginPending?'Securely retrieving the customer profile and linked policy details.':'Sign-in is a secure account step. Specialist agents begin only when insurance analysis is needed.',state.loginPending?'جارٍ استرجاع ملف العميل وتفاصيل الوثيقة المرتبطة بأمان.':'تسجيل الدخول خطوة آمنة للحساب. يبدأ الوكلاء المتخصصون فقط عند الحاجة إلى تحليل التأمين.')};
 if(state.stage==='customer-profile')return {icon:'user',eyebrow:copy(chat,renewal?'RENEWAL PROFILE':'CUSTOMER PROFILE',renewal?'ملف التجديد':'ملف العميل'),title:copy(chat,renewal?'Existing customer preparing a renewal review':state.profileJourney?.mode==='explore-purchase'?'Customer completing details before purchase':'New customer creating an ART profile',renewal?'عميل حالي يجهز مراجعة التجديد':state.profileJourney?.mode==='explore-purchase'?'العميل يكمل التفاصيل قبل الشراء':'عميل جديد ينشئ ملف ART'),description:copy(chat,'The form is in progress. Uploading an identity document will start document scanning and validation commentary here.','النموذج قيد الإكمال. سيبدأ تحميل مستند الهوية تعليق المسح والتحقق هنا.')};
 if(flow.stage==='capture')return {icon:'user',eyebrow:copy(chat,'PURCHASE DETAILS','تفاصيل الشراء'),title:copy(chat,`${state.authenticated?'Existing':'New'} customer preparing ${motor?'Motor':'Life'} Insurance details`,`${state.authenticated?'عميل حالي':'عميل جديد'} يجهز تفاصيل تأمين ${motor?'المركبات':'الحياة'}`),description:copy(chat,'Customer and product details are being collected before the final review.','يتم جمع بيانات العميل والمنتج قبل المراجعة النهائية.')};
 if(state.stage==='new-entry')return {icon:'user',eyebrow:copy(chat,'NEW CUSTOMER','عميل جديد'),title:copy(chat,'Choose account creation or explore as a guest','اختر إنشاء حساب أو الاستكشاف كضيف'),description:copy(chat,'No specialist is running yet. Agent activity begins when insurance guidance or document validation is requested.','لا يعمل أي وكيل متخصص الآن. يبدأ النشاط عند طلب إرشاد تأميني أو التحقق من مستند.')};
 if(state.stage==='existing-entry')return {icon:'user',eyebrow:copy(chat,'EXISTING CUSTOMER','عميل حالي'),title:copy(chat,'Choose renewal or a new policy journey','اختر رحلة التجديد أو وثيقة جديدة'),description:copy(chat,'No specialist is running yet. The selected journey will determine which expertise is needed.','لا يعمل أي وكيل متخصص الآن. تحدد الرحلة المختارة الخبرة المطلوبة.')};
 if(state.stage==='explore'&&(life||motor||flow.stage))return {icon:motor?'car':'shield',eyebrow:copy(chat,motor?'MOTOR INSURANCE JOURNEY':'LIFE INSURANCE JOURNEY',motor?'رحلة تأمين المركبات':'رحلة تأمين الحياة'),title:copy(chat,renewal?'Existing customer looking to renew Life Insurance':motor?'Customer exploring Motor Insurance':'Customer looking for Life Insurance',renewal?'عميل حالي يرغب في تجديد تأمين الحياة':motor?'العميل يستكشف تأمين المركبات':'العميل يبحث عن تأمين الحياة'),description:copy(chat,'The journey is ready. Relevant specialists appear here only when a calculation, recommendation or validation is running.','الرحلة جاهزة. يظهر المختصون هنا فقط عند تشغيل حساب أو توصية أو تحقق.')};
 return {icon:'shield',eyebrow:copy(chat,'HIMAYA','حماية'),title:copy(chat,'Begin your insurance journey','ابدأ رحلتك التأمينية'),description:copy(chat,'Choose a customer path or ask Himaya about Life or Motor Insurance.','اختر مسار العميل أو اسأل حماية عن تأمين الحياة أو المركبات.')};
}

function eventAgents(event){
 if(event.type==='document')return documentWorkflowAgents;
 if(event.type==='employment')return [{key:'employment',icon:'shield',name:'Employment Verification Agent',detail:'Checks employment evidence across simulated official-record steps.'}];
 if(event.type==='medical-document')return [{key:'medical-document',icon:'file',name:'Document Intelligence Agent',detail:'Reads, classifies and organises uploaded medical reports for underwriting review.'}];
 if(event.type==='analysis')return [{key:'analysis',icon:'sliders',name:'Analysis Agent',detail:'Interprets the selected plan or updated calculator inputs and prepares the rating scenario.'},{key:'pricing',icon:'spark',name:'Pricing Agent',detail:'Applies pricing factors, affordability limits, benefits and the final premium scenario.'}];
 if(event.type==='underwriting-medical-summary')return [{key:'underwriting',icon:'sliders',name:'Underwriting Agent',detail:'Checks the customer, selected cover and application readiness.'},{key:'medical-summary',icon:'heart',name:'Medical Summary Agent',detail:'Consolidates the available medical evidence into an underwriting-ready risk summary.'}];
 if(event.type==='recommendation')return [{key:'recommendation',icon:'spark',name:'Recommendation Agent',detail:'Ranks policy fit using age, salary, dependants and protection needs.'}];
 return (event.agentSequence||[]).map(id=>{const agent=agents[id-1]||agents[0];return {key:agent.key,icon:agent.icon,name:agent.name,detail:agent.purpose};});
}

function eventActiveIndex(chat,event){
 if(event.status==='complete')return eventAgents(event).length;
 if(event.type==='document')return Math.min(documentWorkflowAgents.length-1,Math.floor(Math.max(0,Date.now()-event.startedAt)/(DOCUMENT_AGENT_WORK_MS/documentWorkflowAgents.length)));
 if(event.type==='employment')return 0;
 if(['analysis','underwriting-medical-summary'].includes(event.type))return Math.min(1,Math.floor(Math.max(0,Date.now()-event.startedAt)/((event.plannedDurationMs||ANALYSIS_AGENT_WORK_MS)/2)));
 if(event.steps?.length&&event.plannedDurationMs)return Math.min(event.steps.length-1,Math.floor(Math.max(0,Date.now()-event.startedAt)/(event.plannedDurationMs/event.steps.length)));
 return chat.agentWork?.activityId===event.id?Number(chat.agentWork.sequenceIndex)||0:0;
}

function handoffGraphMarkup(chat,event){
 const nodes=eventAgents(event),active=eventActiveIndex(chat,event);
 return `<div class="agent-handoff-graph" aria-label="${copy(chat,'Agent handoff map','خريطة تحويل الوكلاء')}">${nodes.map((agent,index)=>`<div class="handoff-node ${event.status==='complete'||index<active?'complete':index===active?'running':'waiting'}"><span>${event.status==='complete'||index<active?icon('check'):icon(agent.icon)}</span><strong>${esc(agent.name.replace(' Agent',''))}</strong></div>${index<nodes.length-1?`<div class="handoff-link ${event.status==='complete'||index<active?'complete':index===active?'live':''}"><i></i><small>${copy(chat,'handoff','تحويل')}</small></div>`:''}`).join('')}</div>`;
}

function employmentPortalSteps(chat,verification){
 const elapsed=verification?.status==='complete'?EMPLOYMENT_VERIFICATION_MS:Math.max(0,Date.now()-(verification?.startedAt||Date.now())),thresholds=[0,32000,65000,93000],rows=[
  ['MHRSD employment record check','Simulating employer and employment-status review through the Ministry of Human Resources and Social Development portal.'],
  ['Government-specific verification services','Simulating a cross-check against relevant government verification services.'],
  ['Employer letter consistency review','Reading the uploaded employer letter and comparing employer, role and salary details.'],
  ['Other official records & consolidation','Reviewing remaining simulated sources and preparing one employment summary.']
 ];
 const active=Math.min(rows.length-1,thresholds.filter(value=>elapsed>=value).length-1);
 return rows.map(([title,detail],index)=>({title:copy(chat,title,title),detail:copy(chat,detail,detail),state:verification?.status==='complete'||index<active?'done':index===active?'live':'queued'}));
}

function employmentVerificationMarkup(chat){
 const verification=chat.state.employmentVerification;if(!verification)return '';
 const elapsed=Math.min(EMPLOYMENT_VERIFICATION_MS,Math.max(0,(verification.status==='complete'?verification.completedAt:Date.now())-verification.startedAt)),elapsedSeconds=Math.floor(elapsed/1000),targetSeconds=Math.floor(EMPLOYMENT_VERIFICATION_MS/1000),steps=employmentPortalSteps(chat,verification),done=verification.status==='complete',event=activityHistory(chat).find(item=>item.id===verification.activityId);
 return `<section class="employment-verification-card ${done?'complete':'running'}"><div class="employment-card-head"><span>${icon('shield')}</span><div><small>${copy(chat,done?'COMPLETED AGENT':'BACKGROUND AGENT',done?'وكيل مكتمل':'وكيل يعمل في الخلفية')}</small><strong>${copy(chat,'Employment Verification Agent','وكيل التحقق من التوظيف')}</strong></div><em data-employment-elapsed>${done?`${icon('check')} ${Math.floor(elapsedSeconds/60)}:${String(elapsedSeconds%60).padStart(2,'0')}`:`${copy(chat,'Elapsed','المنقضي')} ${Math.floor(elapsedSeconds/60)}:${String(elapsedSeconds%60).padStart(2,'0')} / ${Math.floor(targetSeconds/60)}:${String(targetSeconds%60).padStart(2,'0')}`}</em></div><div class="simulation-disclosure">${icon('info')}<span><strong>${copy(chat,'Demonstration simulation','محاكاة توضيحية')}</strong>${copy(chat,'No live government portal or official record is being accessed.','لا يتم الوصول إلى أي بوابة حكومية أو سجل رسمي مباشر.')}</span></div><div class="employment-portal-stream">${steps.map(step=>`<div class="portal-check ${step.state}"><i>${step.state==='done'?icon('check'):step.state==='live'?'<span></span>':''}</i><div><strong>${esc(step.title)}</strong><small>${esc(step.detail)}</small></div></div>`).join('')}</div>${done?riskSignalMarkup(chat,event?.risk):''}</section>`;
}

function historySteps(chat,event){
 if(event.status==='superseded')return eventAgents(event).map(agent=>({title:agent.name,detail:agent.detail,state:'queued'}));
 if(event.type==='document'){
  const active=eventActiveIndex(chat,event);return documentWorkflowAgents.map((agent,index)=>({title:agent.name,detail:agent.detail,state:event.status==='complete'||index<active?'done':index===active?'live':'queued'}));
 }
 if(event.type==='employment')return employmentPortalSteps(chat,chat.state.employmentVerification);
 if(event.steps?.length){const active=eventActiveIndex(chat,event);return event.steps.map((step,index)=>({...step,state:event.status==='complete'||index<active?'done':index===active?'live':'queued'}));}
 const active=eventActiveIndex(chat,event);return eventAgents(event).map((agent,index)=>({title:agent.name,detail:agent.detail,state:event.status==='complete'||index<active?'done':index===active?'live':'queued'}));
}

function activityHistoryMarkup(chat,excluded=[]){
 const excludedIds=new Set(excluded.filter(Boolean));activityHistory(chat).forEach(event=>{if(event.status==='superseded')event.status='complete';});const history=[...activityHistory(chat)].filter(event=>!excludedIds.has(event.id)).reverse();if(!history.length)return '';
 return `<section class="agent-history"><div class="agent-history-heading"><span><small>${copy(chat,'ORCHESTRATION HISTORY','سجل التنسيق')}</small><strong>${copy(chat,'Completed & previous activity','النشاط المكتمل والسابق')}</strong></span><em>${history.length}</em></div>${history.map((event,index)=>{const steps=historySteps(chat,event),finished=event.status!=='running',duration=finished?`${((event.durationMs||0)/1000).toFixed(1)}s`:copy(chat,'In progress','قيد التنفيذ'),label=event.type==='document'?copy(chat,'Identity document orchestration','تنسيق مستند الهوية'):event.type==='employment'?copy(chat,'Employment verification','التحقق من التوظيف'):event.type==='medical-document'?copy(chat,'Medical document intelligence','ذكاء المستندات الطبية'):event.title||copy(chat,'Agent orchestration','تنسيق الوكلاء');return `<details class="agent-history-version ${event.status}" ${index===0?'open':''}><summary><span class="history-version-mark">v${history.length-index}</span><span><strong>${esc(label)}</strong><small>${esc(event.prompt||copy(chat,'Background workflow','سير عمل في الخلفية'))}</small></span><em>${event.status==='complete'?`${icon('check')} ${duration}`:`<i></i> ${duration}`}</em></summary><div class="history-version-body">${handoffGraphMarkup(chat,event)}<div class="history-step-list">${steps.map(step=>`<div class="history-step ${step.state}"><i>${step.state==='done'?icon('check'):step.state==='live'?'<span></span>':''}</i><span><strong>${esc(step.title)}</strong><small>${esc(step.detail)}</small></span></div>`).join('')}</div>${metricMarkup(event)}${formulaMarkup(event)}${recommendationResultMarkup(chat,event)}${riskSignalMarkup(chat,event.risk)}</div></details>`;}).join('')}</section>`;
}

function completeEmploymentVerification(chat){
 const verification=chat.state.employmentVerification;if(!verification||verification.status==='complete')return;verification.status='complete';verification.completedAt=verification.startedAt+EMPLOYMENT_VERIFICATION_MS;const event=activityHistory(chat).find(item=>item.id===verification.activityId);if(event){event.status='complete';event.completedAt=verification.completedAt;event.durationMs=EMPLOYMENT_VERIFICATION_MS;event.risk={label:'Employment Risk',level:'low',value:'Low',detail:'Simulated employer, salary and supporting-letter checks completed without a flagged inconsistency.'};}chat.persist();finalizeMedicalSummary(chat);chat.refreshAgentWorkspace?.();const flowStage=chat.state.purchaseFlow?.stage,recommendationStage=chat.state.stage==='customer-profile'||flowStage==='recommendations';if(recommendationStage)startRecommendationAgent(chat);
}

function ensureEmploymentTimer(chat){
 const verification=chat.state.employmentVerification;if(!verification||verification.status!=='running'||chat.employmentVerificationTimer)return;
 const tick=()=>{chat.employmentVerificationTimer=null;const current=chat.state.employmentVerification;if(!current||current.status!=='running')return;if(Date.now()>=current.completesAt){completeEmploymentVerification(chat);return;}chat.refreshAgentWorkspace?.();chat.employmentVerificationTimer=setTimeout(tick,1000);};
 chat.employmentVerificationTimer=setTimeout(tick,250);
}

function startEmploymentVerification(chat,fileName=''){
 if(chat.state.employmentVerification?.status==='running')return;const startedAt=Date.now(),work={agentId:4,agentSequence:[4],prompt:fileName?`Verify employment evidence after ${fileName}`:'Verify employment evidence',title:'Employment verification'};const event=beginActivity(chat,work,{type:'employment',title:'Employment verification'});chat.state.employmentVerification={status:'running',startedAt,completesAt:startedAt+EMPLOYMENT_VERIFICATION_MS,activityId:event.id,fileName};chat.persist();ensureEmploymentTimer(chat);chat.refreshAgentWorkspace?.();
}

const medicalHospitals=['King Faisal Specialist Hospital & Research Centre','King Fahad Medical City','King Saud Medical City','King Abdulaziz Medical City','Saudi German Hospital'];
function medicalDocumentSteps(files=[]){const count=Math.max(1,files.length);return [
 {title:'Reading 100+ pages of medical evidence',detail:`Simulating high-volume reading across ${count} uploaded file${count===1?'':'s'} in Arabic & English, including printed and handwritten pages.`},
 {title:'Sorting discharge summaries',detail:'Classifying discharge summaries, physician notes, admission records and treatment histories into a structured medical timeline.'},
 {title:'Recognising ECG and cardiology reports',detail:'Locating ECG, echocardiogram and cardiology sections and separating them from general clinical notes.'},
 {title:'Organising lab and oncology reports',detail:'Grouping laboratory, pathology, radiology and oncology reports so an underwriter can review the relevant evidence.'},
 {title:'Consolidating medical evidence',detail:'Preparing one indexed medical-document summary for underwriting without making a diagnosis or medical decision.'}
 ];}
function medicalDocumentIntelligenceMarkup(chat){
 const medical=chat.state.medicalDocumentIntelligence;if(!medical)return '';const event=activityHistory(chat).find(item=>item.id===medical.activityId),done=medical.status==='complete',elapsed=Math.min(MEDICAL_DOCUMENT_INTELLIGENCE_MS,Math.max(0,(done?medical.completedAt:Date.now())-medical.startedAt)),elapsedSeconds=Math.floor(elapsed/1000),targetSeconds=Math.floor(MEDICAL_DOCUMENT_INTELLIGENCE_MS/1000),active=eventActiveIndex(chat,event||{}),steps=(event?.steps||medicalDocumentSteps(medical.files)).map((step,index)=>({...step,state:done||index<active?'done':index===active?'live':'queued'}));
 return `<section class="employment-verification-card medical-document-intelligence-card ${done?'complete':'running'}"><div class="employment-card-head"><span>${icon('file')}</span><div><small>${copy(chat,done?'COMPLETED AGENT':'BACKGROUND AGENT',done?'وكيل مكتمل':'وكيل يعمل في الخلفية')}</small><strong>${copy(chat,'Document Intelligence Agent','وكيل ذكاء المستندات')}</strong></div><em data-medical-elapsed>${done?`${icon('check')} ${Math.floor(elapsedSeconds/60)}:${String(elapsedSeconds%60).padStart(2,'0')}`:`${copy(chat,'Elapsed','المنقضي')} ${Math.floor(elapsedSeconds/60)}:${String(elapsedSeconds%60).padStart(2,'0')} / ${Math.floor(targetSeconds/60)}:${String(targetSeconds%60).padStart(2,'0')}`}</em></div><div class="simulation-disclosure">${icon('info')}<span><strong>${copy(chat,'Demonstration document intelligence','محاكاة توضيحية لذكاء المستندات')}</strong>${copy(chat,'No diagnosis is made and no hospital system is accessed. The workflow demonstrates document classification only.','لا يتم إجراء تشخيص أو الوصول إلى أي نظام مستشفى. يوضح سير العمل تصنيف المستندات فقط.')}</span></div><div class="medical-file-summary"><strong>${copy(chat,'Uploaded medical evidence','الأدلة الطبية المرفوعة')}</strong><span>${esc((medical.files||[]).map(file=>file.name).join(', ')||'Medical report')}</span></div><div class="employment-portal-stream">${steps.map(step=>`<div class="portal-check ${step.state}"><i>${step.state==='done'?icon('check'):step.state==='live'?'<span></span>':''}</i><div><strong>${esc(step.title)}</strong><small>${esc(step.detail)}</small></div></div>`).join('')}</div><div class="medical-hospital-list"><small>${copy(chat,'RECOGNISING REPORT FORMATS FROM MAJOR KSA HOSPITALS','التعرف على تنسيقات التقارير من مستشفيات رئيسية في المملكة')}</small>${medicalHospitals.map(name=>`<span>${esc(name)}</span>`).join('')}</div></section>`;
}
function completeMedicalDocumentIntelligence(chat){const medical=chat.state.medicalDocumentIntelligence;if(!medical||medical.status==='complete')return;medical.status='complete';medical.completedAt=medical.startedAt+MEDICAL_DOCUMENT_INTELLIGENCE_MS;const event=activityHistory(chat).find(item=>item.id===medical.activityId);if(event){event.status='complete';event.completedAt=medical.completedAt;event.durationMs=MEDICAL_DOCUMENT_INTELLIGENCE_MS;}chat.persist();finalizeMedicalSummary(chat);chat.refreshAgentWorkspace?.();}
function ensureMedicalDocumentTimer(chat){const medical=chat.state.medicalDocumentIntelligence;if(!medical||medical.status!=='running'||chat.medicalDocumentTimer)return;const tick=()=>{chat.medicalDocumentTimer=null;const current=chat.state.medicalDocumentIntelligence;if(!current||current.status!=='running')return;if(Date.now()>=current.completesAt){completeMedicalDocumentIntelligence(chat);return;}chat.refreshAgentWorkspace?.();chat.medicalDocumentTimer=setTimeout(tick,1000);};chat.medicalDocumentTimer=setTimeout(tick,250);}
function startMedicalDocumentIntelligence(chat,files=[]){if(!files.length)return;const startedAt=Date.now(),work={agentId:2,agentSequence:[2],prompt:`Read and classify ${files.length} uploaded medical report${files.length===1?'':'s'}`,title:'Medical document intelligence'},event=beginActivity(chat,work,{type:'medical-document',title:'Medical document intelligence'}),steps=medicalDocumentSteps(files);event.steps=steps;event.plannedDurationMs=MEDICAL_DOCUMENT_INTELLIGENCE_MS;event.metrics=[{label:'Files received',value:files.length},{label:'Languages',value:'Arabic & English'},{label:'Page capacity',value:'100+ pages'},{label:'Report types',value:'Discharge · ECG · Lab · Oncology'}];chat.state.medicalDocumentIntelligence={status:'running',startedAt,completesAt:startedAt+MEDICAL_DOCUMENT_INTELLIGENCE_MS,activityId:event.id,files:files.map(file=>({name:file.name,size:Number(file.size)||0}))};chat.state.agentInteractionStarted=true;chat.persist();ensureMedicalDocumentTimer(chat);chat.refreshAgentWorkspace?.();}

function currentPlanningSnapshot(chat){
 const form=chat.host.querySelector('#customer-profile-form,#purchase-details-form'),read=name=>form?.elements?.[name]?.value,profile=chat.state.profile||{};
 return {age:Number(read('age')||profile.age||0),monthlyIncome:Number(read('monthlyIncome')||profile.monthlyIncome||profile.salary||0),dependants:Number(read('dependants')||profile.dependants||0),coverage:Number(read('coverage')||profile.coverage||0),budget:Number(read('budget')||profile.budget||0),term:Number(read('term')||profile.term||0)};
}

function startTimedSpecialist(chat,{agentId,type,duration,prompt,title,steps,risk,metrics,formulae,nonBlocking=false,workflow,onComplete}){
 const token=++chat.agentWorkSequence,work=orchestratedWork(chat,[agentId],prompt);work.demoDurationMs=duration;work.nonBlocking=nonBlocking;work.customSteps=steps;work[workflow]=true;work.title=title;work.detail=steps[0]?.detail||work.detail;chat.agentWork=work;chat.state.agentInteractionStarted=true;chat.state.agentPanelStage=agentId;chat.state.aiPending=!nonBlocking;chat.workKind='agent-transition';const event=beginActivity(chat,work,{type,title});event.steps=steps;event.risk=risk;event.metrics=metrics;event.formulae=formulae;event.plannedDurationMs=duration;chat.persist();paintAgentWork(chat);scheduleWorkspaceProgress(chat,token);setTimeout(()=>{if(chat.agentWorkSequence!==token||chat.agentWork?.activityId!==work.activityId)return;const completed={...chat.agentWork,status:'complete',durationMs:duration,completedAt:Date.now()};finishAgentWork(chat,completed);onComplete?.();},duration);return work;
}

function startRecommendationAgent(chat){
 const snapshot=currentPlanningSnapshot(chat),steps=[
  {title:'Reviewing age and eligibility context',detail:`Using age ${snapshot.age||'not provided'} to check the suitable planning range.`},
  {title:'Assessing salary and affordability',detail:`Using monthly income ${snapshot.monthlyIncome.toLocaleString('en-SA')} SAR to frame an affordable direction.`},
  {title:'Weighting dependant protection needs',detail:`Accounting for ${snapshot.dependants} dependant${snapshot.dependants===1?'':'s'} and the available protection details.`},
  {title:'Ranking policy fit',detail:'Comparing protection fit, estimated affordability and customer priorities before presenting recommendations.'}
 ],metrics=[{label:'Age',value:snapshot.age||'—'},{label:'Monthly income',value:snapshot.monthlyIncome?`${snapshot.monthlyIncome.toLocaleString('en-SA')} SAR`:'—'},{label:'Dependants',value:snapshot.dependants},{label:'Planning term',value:snapshot.term?`${snapshot.term} years`:'—'}];
 return startTimedSpecialist(chat,{agentId:5,type:'recommendation',duration:RECOMMENDATION_AGENT_WORK_MS,prompt:'Recommend suitable policies from the verified customer profile',title:'Preparing a profile-based policy recommendation',steps,metrics,workflow:'recommendationWorkflow'});
}

function legacyStartUnderwritingHandoff(chat,onComplete){const profile=chat.state.profile||{},summary=chat.state.purchaseFlow?.contactSummary||{},steps=[
 {title:'Bringing customer details',detail:'Retrieving the customer profile, selected policy and the latest calculator scenario for underwriting.'},
 {title:'Checking application completeness',detail:`Reviewing age ${profile.age||'—'}, salary ${Number(profile.monthlyIncome||profile.salary||0).toLocaleString('en-SA')} SAR and ${Number(profile.dependants||0)} dependants.`},
 {title:'Linking policy and benefits',detail:'Connecting the selected cover, monthly premium and optional benefits to the customer application.'},
 {title:'Preparing the review form',detail:'Passing the assembled customer details to the secure review form.'}
],metrics=[{label:'Customer',value:summary.name||profile.fullName||'Customer profile'},{label:'Selected policy',value:chat.state.purchaseFlow?.option||chat.state.purchaseFlow?.syntheticPolicy?.name||'Selected policy'},{label:'Customer details',value:'Profile ready'},{label:'Next step',value:'Review form'}];return startTimedSpecialist(chat,{agentId:4,type:'underwriting',duration:UNDERWRITING_HANDOFF_MS,prompt:'Bring customer details into underwriting and prepare the review form',title:'Bringing customer details for underwriting',steps,metrics,nonBlocking:false,workflow:'underwritingWorkflow',onComplete});}

function backgroundAgentRunning(chat){return chat.state.employmentVerification?.status==='running'||chat.state.medicalDocumentIntelligence?.status==='running';}
function lowMedicalRisk(){return {label:'Medical Risk',level:'low',value:'Low',detail:'The available medical evidence indicates good general health with no reported major chronic or life-threatening condition at assessment.'};}
function finalizeMedicalSummary(chat){const summary=chat.state.medicalSummary;if(!summary||summary.status==='complete'||backgroundAgentRunning(chat))return;summary.status='complete';summary.completedAt=Date.now();const event=activityHistory(chat).find(item=>item.id===summary.activityId);if(event){event.risk=lowMedicalRisk();event.revision=(event.revision||0)+1;}chat.persist();if(chat.state.purchaseFlow?.stage==='purchase')chat.render();else chat.refreshAgentWorkspace?.();}
function startUnderwritingHandoff(chat,onComplete){const profile=chat.state.profile||{},contact=chat.state.purchaseFlow?.contactSummary||{},pending=backgroundAgentRunning(chat),steps=[
 {title:'Underwriting Agent receives the application',detail:'Bringing together the customer profile, selected policy, calculator scenario and optional benefits.'},
 {title:'Checking application readiness',detail:`Reviewing age ${profile.age||'not provided'}, salary ${Number(profile.monthlyIncome||profile.salary||0).toLocaleString('en-SA')} SAR and ${Number(profile.dependants||0)} dependants.`},
 {title:'Handing medical evidence to the Medical Summary Agent',detail:pending?'Document Intelligence is still reading the uploaded report; the Medical Summary Agent is preparing the evidence handoff.':'The available medical evidence is ready for summary.'},
 {title:'Preparing the underwriting medical summary',detail:'Consolidating the available health information into a concise risk signal for the final policy request.'}
 ],metrics=[{label:'Customer',value:contact.name||profile.fullName||'Customer profile'},{label:'Selected policy',value:chat.state.purchaseFlow?.option||chat.state.purchaseFlow?.syntheticPolicy?.name||'Selected policy'},{label:'Medical evidence',value:pending?'Background review running':'Available'},{label:'Next step',value:'Policy request review'}],risk=pending?{label:'Medical Risk',level:'review',value:'Pending',detail:'Waiting for all background document checks to complete before confirming the medical-risk summary.'}:lowMedicalRisk(),complete=()=>{chat.state.medicalSummary={status:backgroundAgentRunning(chat)?'pending':'complete',activityId:work.activityId,summary:'The applicant appears to be in good general health and has not reported any major chronic or life-threatening medical conditions at the time of assessment.',completedAt:backgroundAgentRunning(chat)?null:Date.now()};chat.persist();onComplete?.();},work=startTimedSpecialist(chat,{agentId:4,type:'underwriting-medical-summary',duration:UNDERWRITING_HANDOFF_MS,prompt:'Underwriting Agent is handing the application to the Medical Summary Agent',title:'Preparing underwriting and medical summary',steps,metrics,risk,nonBlocking:false,workflow:'underwritingWorkflow',onComplete:complete});return work;}

function analysisFormulae(snapshot={}){
 const coverage=Number(snapshot.coverage||0),monthly=Number(snapshot.monthlyPremium||snapshot.recommendedPremium||snapshot.budget||0),budget=Number(snapshot.budget||monthly),addOns=Number(snapshot.addOnMonthly||0),base=Number(snapshot.baseMonthlyPremium||Math.max(0,monthly-addOns)),available=Math.max(0,budget-addOns),rate=coverage>0?base/coverage*1000:0;
 return [
  {formula:'Available premium = Monthly premium − Add-ons',result:`${budget.toLocaleString('en-SA')} − ${addOns.toLocaleString('en-SA')} = ${available.toLocaleString('en-SA')} SAR`},
  {formula:'Rate per 1,000 = Base premium ÷ Coverage × 1,000',result:rate?`${rate.toFixed(3)} SAR per 1,000`:'Waiting for calculated coverage'},
  {formula:'Target coverage = floor(Available premium ÷ Rate × 1,000 ÷ 25,000) × 25,000',result:coverage?`${coverage.toLocaleString('en-SA')} SAR`:'Calculating'},
  {formula:'Annual estimate = Monthly total × 12',result:monthly?`${monthly.toLocaleString('en-SA')} × 12 = ${(monthly*12).toLocaleString('en-SA')} SAR`:'Calculating'}
 ];
}

function startAnalysisAgent(chat,key,snapshot={},onComplete){
 const labels={budget:'monthly premium',coverage:'coverage amount',age:'age',term:'cover duration',frequency:'payment frequency',monthlyIncome:'monthly income',dependants:'dependants',existingCover:'existing cover',riskPreference:'risk preference',educationFund:'education fund',savingsTarget:'savings target'},field=labels[key]||key||'calculator input',steps=[
  {title:`Reading the updated ${field}`,detail:`The Analysis Agent received the latest ${field} and preserved the other calculator inputs.`},
  {title:'Recalculating rate factors',detail:`Re-evaluating age ${snapshot.age||'—'}, term ${snapshot.term||'—'} years and the selected planning direction.`},
  {title:'Testing affordability',detail:`Comparing the estimated monthly amount with income ${Number(snapshot.monthlyIncome||0).toLocaleString('en-SA')} SAR and budget ${Number(snapshot.budget||0).toLocaleString('en-SA')} SAR.`},
  {title:'Analysing best-possible coverage',detail:`Reviewing coverage ${Number(snapshot.coverage||0).toLocaleString('en-SA')} SAR against plan limits and the latest inputs.`},
  {title:'Preparing the updated scenario',detail:'Formatting monthly, annual and selected-frequency values for review in the calculator.'}
 ],metrics=[{label:'Changed input',value:field},{label:'Coverage',value:snapshot.coverage?`${Number(snapshot.coverage).toLocaleString('en-SA')} SAR`:'Calculating'},{label:'Monthly estimate',value:snapshot.monthlyPremium||snapshot.recommendedPremium?`${Number(snapshot.monthlyPremium||snapshot.recommendedPremium).toLocaleString('en-SA')} SAR`:'Calculating'},{label:'Annual estimate',value:snapshot.monthlyPremium||snapshot.recommendedPremium?`${(Number(snapshot.monthlyPremium||snapshot.recommendedPremium)*12).toLocaleString('en-SA')} SAR`:'Calculating'}];
 return startTimedSpecialist(chat,{agentId:4,type:'analysis',duration:ANALYSIS_AGENT_WORK_MS,prompt:`Analyse the ${field} change`,title:'Analysing rates and best-possible coverage',steps,metrics,formulae:analysisFormulae(snapshot),nonBlocking:true,workflow:'analysisWorkflow',onComplete});
}

function updateAnalysisAgent(chat,key,snapshot={}){
 const work=chat.agentWork;if(!work?.analysisWorkflow)return;const event=activityHistory(chat).find(item=>item.id===work.activityId),field=key||'calculator input';work.calculatorSnapshot={...snapshot};work.customSteps[2].detail=`Comparing the estimated monthly amount with income ${Number(snapshot.monthlyIncome||0).toLocaleString('en-SA')} SAR and budget ${Number(snapshot.budget||0).toLocaleString('en-SA')} SAR.`;work.customSteps[3].detail=`Reviewing coverage ${Number(snapshot.coverage||0).toLocaleString('en-SA')} SAR against plan limits and the latest inputs.`;if(event){event.steps=work.customSteps;event.formulae=analysisFormulae(snapshot);event.metrics=[{label:'Changed input',value:field},{label:'Coverage',value:snapshot.coverage?`${Number(snapshot.coverage).toLocaleString('en-SA')} SAR`:'Calculating'},{label:'Monthly estimate',value:snapshot.monthlyPremium||snapshot.recommendedPremium?`${Number(snapshot.monthlyPremium||snapshot.recommendedPremium).toLocaleString('en-SA')} SAR`:'Calculating'},{label:'Annual estimate',value:snapshot.monthlyPremium||snapshot.recommendedPremium?`${(Number(snapshot.monthlyPremium||snapshot.recommendedPremium)*12).toLocaleString('en-SA')} SAR`:'Calculating'}];event.revision=(event.revision||0)+1;}chat.persist();chat.refreshAgentWorkspace?.();
}

function startPolicySelectionAnalysis(chat,plan={},onComplete){
 if(chat.agentWork?.status==='running'&&chat.agentWork.policySelectionWorkflow)return chat.agentWork;
 const profile=chat.state.profile||{},addOnMonthly=Number(chat.state.purchaseFlow?.addOnMonthly||0),baseMonthly=Number((plan.basePremium??plan.premium)||0),monthlyPremium=baseMonthly+addOnMonthly,snapshot={...profile,coverage:Number(plan.coverage||profile.coverage||0),budget:monthlyPremium,baseMonthlyPremium:baseMonthly,addOnMonthly,monthlyPremium,recommendedPremium:monthlyPremium},steps=[
  {title:'Reading the selected policy',detail:`Loading ${plan.name||'the selected policy'}, its cover limits, base premium and selected benefits.`},
  {title:'Applying the customer profile',detail:`Using age ${profile.age||'—'}, salary ${Number(profile.monthlyIncome||profile.salary||0).toLocaleString('en-SA')} SAR and ${Number(profile.dependants||0)} dependants.`},
  {title:'Analysing price and cover',detail:`Testing ${Number(snapshot.coverage).toLocaleString('en-SA')} SAR cover against the selected plan rate and monthly premium.`},
  {title:'Adding recommended benefits',detail:`Including ${addOnMonthly.toLocaleString('en-SA')} SAR per month for the selected add-ons.`},
  {title:'Preparing the calculator scenario',detail:'Stitching the base premium, add-ons, target cover, annual equivalent and editable assumptions into one calculation.'}
 ],metrics=[{label:'Selected plan',value:plan.name||'Selected policy'},{label:'Age',value:profile.age||'—'},{label:'Salary',value:`${Number(profile.monthlyIncome||profile.salary||0).toLocaleString('en-SA')} SAR`},{label:'Dependants',value:Number(profile.dependants||0)},{label:'Target coverage',value:`${Number(snapshot.coverage).toLocaleString('en-SA')} SAR`},{label:'Monthly total',value:`${monthlyPremium.toLocaleString('en-SA')} SAR`}];
 const work=startTimedSpecialist(chat,{agentId:4,type:'analysis',duration:ANALYSIS_AGENT_WORK_MS,prompt:`Analyse ${plan.name||'the selected policy'} using the customer profile`,title:'Analysing the selected plan, price and coverage',steps,metrics,formulae:analysisFormulae(snapshot),nonBlocking:false,workflow:'analysisWorkflow',onComplete});work.policySelectionWorkflow=true;return work;
}

function legacyWorkspaceMarkup(chat){
 const hasActivity=Boolean(chat.state.agentInteractionStarted||chat.agentWork||chat.lastAgentRun||(chat.state.agentRunHistory||[]).length);
 if(!hasActivity){const narrative=journeyNarrative(chat);return `<div class="agent-orchestration-head"><span class="agent-head-icon">${icon('spark')}</span><div><h2>${copy(chat,"What's happening",'ما الذي يحدث')}</h2><p>${copy(chat,'Journey commentary','تعليق الرحلة')}</p></div><span class="orchestration-live"><i></i>${copy(chat,'Ready','جاهز')}</span></div><div class="agent-commentary-content agent-commentary-empty" aria-label="${esc(narrative.title)}"><div class="agent-empty-state journey-context-state"><span>${icon(narrative.icon)}</span><small>${esc(narrative.eyebrow)}</small><h3>${esc(narrative.title)}</h3><p>${esc(narrative.description)}</p></div></div>`;}
 const current=activeStage(chat),working=chat.agentWork?.status==='running',selected=working?current:Number(chat.state.agentPanelStage)||current,selectedAgent=agents.find(agent=>agent.id===selected)||agents[current-1],selectedStatus=statusFor(chat,selectedAgent.id,current),document=chat.state.agentDocumentCheck,baseRun=working?chat.agentWork:chat.lastAgentRun,run=baseRun&&baseRun.agentId===selected?baseRun:{agentId:selected,status:selectedStatus==='complete'?'complete':'active',startedAt:performance.now(),agentStartedAt:performance.now(),title:selectedAgent.purpose,prompt:''},steps=executionSteps(chat,selectedAgent,run),prompt=latestPrompt(chat,run),duration=run.durationMs?`${(run.durationMs/1000).toFixed(1)}s`:'',currentEvent=activityHistory(chat).find(item=>item.id===run.activityId)||activityHistory(chat).at(-1);
 return `<div class="agent-orchestration-head"><span class="agent-head-icon">${icon('spark')}</span><div><h2>${copy(chat,"What's happening","ما الذي يحدث")}</h2><p>${copy(chat,'Live agent activity','نشاط الوكلاء المباشر')}</p></div><span class="orchestration-live"><i></i>${copy(chat,'Live','مباشر')}</span></div>
 <div class="agent-commentary-content">${employmentVerificationMarkup(chat)}
 <section class="agent-run-card ${run.status}" aria-live="polite"><div class="agent-run-summary"><div><strong>“${esc(prompt)}”</strong><span>Himaya · ${copy(chat,'intent-led orchestration','تنسيق مبني على الهدف')}</span></div><em>${run.status==='complete'?`${icon('check')} ${copy(chat,`Done in ${duration||'6.0s'}`,`اكتمل خلال ${duration||'6.0 ثانية'}`)}`:run.status==='running'?`${icon('spark')} ${copy(chat,'Working','يعمل الآن')}`:copy(chat,'Current specialist','الوكيل الحالي')}</em></div><div class="agent-run-owner"><span>${icon(selectedAgent.icon)}</span><div><small>${copy(chat,run.status==='running'?'ACTIVE SPECIALIST':'SPECIALIST',run.status==='running'?'الوكيل النشط':'الوكيل المتخصص')}</small><strong>${esc(run.documentWorkflow?copy(chat,'Document Scanning & Validation Agents','وكلاء مسح المستندات والتحقق'):copy(chat,selectedAgent.name,selectedAgent.ar))}</strong></div></div>${currentEvent?handoffGraphMarkup(chat,currentEvent):''}<div class="agent-execution-timeline">${steps.map((step,index)=>{const stepState=step.state||timelineState(run,index,steps.length);return `<div class="agent-timeline-step ${stepState}"><i>${stepState==='done'?icon('check'):stepState==='live'?'<span></span>':''}</i><div><strong>${esc(step.title)}</strong><small>${esc(step.detail)}</small></div></div>`;}).join('')}</div>${document&&selectedAgent.id===2?`<div class="document-agent-result ${document.status}">${icon(document.status==='valid'?'check':document.status==='invalid'?'info':'file')}<span><strong>${esc(copy(chat,document.title,document.titleAr))}</strong><small>${esc(copy(chat,document.message,document.messageAr))}</small></span></div>`:''}</section>
 ${activityHistoryMarkup(chat)}<details class="agent-roster"><summary>${copy(chat,'Available specialists','الوكلاء المتخصصون')}<span>${copy(chat,'View specialists','عرض الوكلاء')}</span></summary><div class="agent-stage-list">${agents.map(agent=>{const status=statusFor(chat,agent.id,current);return `<button class="agent-stage-row ${status} ${selected===agent.id?'selected':''}" data-agent-stage="${agent.id}" aria-pressed="${selected===agent.id}"><span class="agent-stage-number">${status==='complete'?icon('check'):icon(agent.icon)}</span><span><strong>${esc(copy(chat,agent.name,agent.ar))}</strong><small>${esc(copy(chat,agent.purpose,agent.purposeAr))}</small></span><em>${statusLabel(chat,status)}</em></button>`;}).join('')}</div></details></div>
 <div class="agent-commentary-footer">${icon('sliders')}<span>${copy(chat,'Himaya multi-agent orchestration · steps stream live','تنسيق حماية متعدد الوكلاء · بث الخطوات مباشر')}</span></div>`;
}

function currentRunMarkup(chat,run,selectedAgent,event){
 const steps=executionSteps(chat,selectedAgent,run),prompt=latestPrompt(chat,run),duration=run.durationMs?`${(run.durationMs/1000).toFixed(1)}s`:'',document=chat.state.agentDocumentCheck,name=run.documentWorkflow?'Document Scanning & Validation Agents':run.analysisWorkflow?'Analysis Agent':run.recommendationWorkflow?'Recommendation Agent':run.underwritingWorkflow?'Underwriting Agent':copy(chat,selectedAgent.name,selectedAgent.ar),agentIcon=run.analysisWorkflow||run.underwritingWorkflow?'sliders':run.recommendationWorkflow?'spark':selectedAgent.icon;
 return `<section class="agent-run-card current-agent-card ${run.status}" aria-live="polite"><div class="current-agent-label"><i></i>${copy(chat,run.status==='running'?'CURRENT AGENT':'LATEST AGENT',run.status==='running'?'الوكيل الحالي':'أحدث وكيل')}</div><div class="agent-run-summary"><div><strong>“${esc(prompt)}”</strong><span>Himaya · ${copy(chat,'intent-led orchestration','تنسيق مبني على الهدف')}</span></div><em>${run.status==='complete'?`${icon('check')} ${copy(chat,`Done in ${duration||'6.0s'}`,`اكتمل خلال ${duration||'6.0 ثانية'}`)}`:run.status==='running'?`${icon('spark')} ${copy(chat,'Working','يعمل الآن')}`:copy(chat,'Current specialist','الوكيل الحالي')}</em></div><div class="agent-run-owner"><span>${icon(agentIcon)}</span><div><small>${copy(chat,run.status==='running'?'ACTIVE SPECIALIST':'SPECIALIST',run.status==='running'?'الوكيل النشط':'الوكيل المتخصص')}</small><strong>${esc(name)}</strong></div></div>${event?handoffGraphMarkup(chat,event):''}<div class="agent-execution-timeline">${steps.map((step,index)=>{const stepState=step.state||timelineState(run,index,steps.length);return `<div class="agent-timeline-step ${stepState}"><i>${stepState==='done'?icon('check'):stepState==='live'?'<span></span>':''}</i><div><strong>${esc(step.title)}</strong><small>${esc(step.detail)}</small></div></div>`;}).join('')}</div>${metricMarkup(event)}${formulaMarkup(event)}${recommendationResultMarkup(chat,event)}${riskSignalMarkup(chat,event?.risk)}${document&&run.documentWorkflow?`<div class="document-agent-result ${document.status}">${icon(document.status==='valid'?'check':document.status==='invalid'?'info':'file')}<span><strong>${esc(copy(chat,document.title,document.titleAr))}</strong><small>${esc(copy(chat,document.message,document.messageAr))}</small></span></div>`:''}</section>`;
}

function workspaceMarkup(chat){
 const hasActivity=Boolean(chat.state.agentInteractionStarted||chat.agentWork||chat.lastAgentRun||(chat.state.agentRunHistory||[]).length||activityHistory(chat).length);
 if(!hasActivity){const narrative=journeyNarrative(chat);return `<div class="agent-orchestration-head"><span class="agent-head-icon">${icon('spark')}</span><div><h2>${copy(chat,"What's happening",'ما الذي يحدث')}</h2><p>${copy(chat,'Journey commentary','تعليق الرحلة')}</p></div><span class="orchestration-live"><i></i>${copy(chat,'Ready','جاهز')}</span></div><div class="agent-commentary-content agent-commentary-empty" aria-label="${esc(narrative.title)}"><div class="agent-empty-state journey-context-state"><span>${icon(narrative.icon)}</span><small>${esc(narrative.eyebrow)}</small><h3>${esc(narrative.title)}</h3><p>${esc(narrative.description)}</p></div></div>`;}
 const working=chat.agentWork?.status==='running',employment=chat.state.employmentVerification,employmentRunning=employment?.status==='running',medical=chat.state.medicalDocumentIntelligence,medicalRunning=medical?.status==='running',baseRun=working?chat.agentWork:chat.lastAgentRun,current=baseRun?.agentId||activeStage(chat),selectedAgent=agents[current-1]||agents[0],run=baseRun||{agentId:current,status:'active',startedAt:performance.now(),agentStartedAt:performance.now(),title:selectedAgent.purpose,prompt:''},runEvent=activityHistory(chat).find(item=>item.id===run.activityId),employmentId=employment?.activityId,medicalId=medical?.activityId,currentIsMedical=medicalRunning&&!working,currentIsEmployment=employmentRunning&&!working&&!medicalRunning,excluded=[working?runEvent?.id:null,employmentRunning?employmentId:null,medicalRunning?medicalId:null],backgroundMarkup=`${employmentRunning?employmentVerificationMarkup(chat):''}${medicalRunning?medicalDocumentIntelligenceMarkup(chat):''}`,currentMarkup=currentIsMedical?`${medicalDocumentIntelligenceMarkup(chat)}${employmentRunning?employmentVerificationMarkup(chat):''}`:currentIsEmployment?employmentVerificationMarkup(chat):`${currentRunMarkup(chat,run,selectedAgent,runEvent)}${backgroundMarkup}`;
 const live=working||employmentRunning||medicalRunning;return `<div class="agent-orchestration-head"><span class="agent-head-icon">${icon('spark')}</span><div><h2>${copy(chat,"What's happening",'ما الذي يحدث')}</h2><p>${copy(chat,'Current agent and step-by-step history','الوكيل الحالي والسجل خطوة بخطوة')}</p></div><span class="orchestration-live"><i></i>${copy(chat,live?'Live':'Ready',live?'مباشر':'جاهز')}</span></div><div class="agent-commentary-content">${currentMarkup}${activityHistoryMarkup(chat,excluded)}</div><div class="agent-commentary-footer">${icon('sliders')}<span>${copy(chat,'Himaya multi-agent orchestration · current work first, completed history below','تنسيق حماية متعدد الوكلاء · العمل الحالي أولاً والسجل المكتمل أدناه')}</span></div>`;
}

function appbarMarkup(chat){
 return `<nav class="agentic-appbar" aria-label="${copy(chat,'Application navigation','تنقل التطبيق')}"><button class="agentic-brand" data-agent-nav="home" aria-label="${copy(chat,'ART Insurance home','الصفحة الرئيسية لتأمين ART')}"><img src="assets/alrajhi-takaful-logo.svg" alt=""><span><strong>Himaya</strong><small>Al Rajhi Takaful</small></span></button><div class="agentic-nav-links"><button data-agent-nav="home">${icon('shield')} ${copy(chat,'Home','الرئيسية')}</button><button class="active" data-agent-nav="chat">${icon('chat')} ${copy(chat,'Chat with Himaya','تحدث مع حماية')}</button></div></nav>`;
}

function documentWorkingMarkup(chat,work){
 const active=documentWorkflowProgress(work),current=documentWorkflowAgents[active],progress=Math.min(100,Math.round(Math.max(0,performance.now()-work.startedAt)/DOCUMENT_AGENT_WORK_MS*100));
 return `<div class="message bot agent-response-work document-orchestration-work" data-agent-work="2" role="status" aria-live="polite"><span class="conversation-avatar agent-avatar">${icon('file')}</span><div class="document-work-bubble"><div class="document-work-heading"><span><small>${copy(chat,'MULTI-AGENT IDENTITY WORKFLOW','سير عمل هوية متعدد الوكلاء')}</small><strong>${copy(chat,'Agents are handing off your document','الوكلاء يتبادلون مستندك')}</strong></span><em>${progress}%</em></div><div class="document-agent-scenes">${documentWorkflowAgents.map((agent,index)=>`<div class="document-agent-scene ${index<active?'complete':index===active?'active':'queued'}" style="--scene:${index}"><div class="scene-visual"><i>${index<active?icon('check'):icon(agent.icon)}</i><span></span><b></b></div><strong>${esc(agent.name)}</strong><small>${index<active?copy(chat,'Handoff complete','اكتمل التحويل'):index===active?copy(chat,'Working now','يعمل الآن'):copy(chat,'Ready','جاهز')}</small></div>${index<documentWorkflowAgents.length-1?`<div class="scene-handoff ${index<active?'complete':index===active?'active':''}"><i></i>${icon('arrow')}</div>`:''}`).join('')}</div><div class="document-live-message"><span>${icon(current.icon)}</span><div><small>${copy(chat,'NOW HAPPENING','يحدث الآن')}</small><strong>${esc(current.name)}</strong><p>${esc(current.detail)}</p></div></div><div class="document-work-progress"><i style="width:${progress}%"></i></div></div></div>`;
}

function specialistWorkingMarkup(chat,work){
 const analysis=Boolean(work.analysisWorkflow),underwriting=Boolean(work.underwritingWorkflow),duration=workDuration(work),elapsed=Math.max(0,performance.now()-work.startedAt),progress=Math.min(100,Math.round(elapsed/duration*100)),steps=work.customSteps||[],active=Math.min(steps.length-1,Math.floor(elapsed/(duration/Math.max(1,steps.length)))),name=analysis?'Analysis Agent':underwriting?'Underwriting Agent':'Recommendation Agent',eyebrow=analysis?'LIVE CALCULATOR ANALYSIS':underwriting?'UNDERWRITING HANDOFF':'PROFILE-BASED RECOMMENDATION',headline=analysis?'Analysing rates and best-possible coverage':underwriting?'Bringing customer details into underwriting':'Finding the strongest policy fit',agentIcon=analysis||underwriting?'sliders':'spark',kind=analysis?'analysis':underwriting?'underwriting':'recommendation';
 return `<div class="message bot agent-response-work specialist-orchestration-work ${kind}-orchestration-work" data-agent-work="${work.agentId}" role="status" aria-live="polite"><span class="conversation-avatar agent-avatar">${icon(agentIcon)}</span><div class="specialist-work-bubble"><div class="specialist-work-hero"><div class="specialist-avatar-animation"><span></span><i>${icon(agentIcon)}</i><b></b></div><div><small>${copy(chat,eyebrow,eyebrow)}</small><strong>${copy(chat,headline,headline)}</strong><p>${esc(steps[active]?.detail||work.detail)}</p></div><em>${progress}%</em></div><div class="specialist-step-strip">${steps.map((step,index)=>`<div class="${index<active?'complete':index===active?'active':'queued'}"><i>${index<active?icon('check'):index+1}</i><span><strong>${esc(step.title)}</strong><small>${index<active?'Complete':index===active?'Working now':'Queued'}</small></span></div>`).join('')}</div><div class="document-work-progress"><i style="width:${progress}%"></i></div><footer>${icon(agentIcon)}<span><small>${kind.toUpperCase()} AGENT</small><strong>${esc(name)}</strong></span><b>${underwriting?'Preparing form':analysis?'Live analysis':'Live recommendation'}</b></footer></div></div>`;
}

function pairedSpecialistWorkingMarkup(chat,work){
 const analysis=Boolean(work.analysisWorkflow),duration=workDuration(work),elapsed=Math.max(0,performance.now()-work.startedAt),progress=Math.min(100,Math.round(elapsed/duration*100)),steps=work.customSteps||[],activeStep=Math.min(steps.length-1,Math.floor(elapsed/(duration/Math.max(1,steps.length)))),activeAgent=elapsed>=duration/2?1:0,nodes=analysis?[{icon:'sliders',name:'Analysis Agent',detail:'Interpreting profile, plan and calculator inputs'},{icon:'spark',name:'Pricing Agent',detail:'Applying rates, benefits and affordability'}]:[{icon:'sliders',name:'Underwriting Agent',detail:'Checking customer and policy readiness'},{icon:'heart',name:'Medical Summary Agent',detail:'Preparing the medical-risk summary'}],eyebrow=analysis?'ANALYSIS TO PRICING HANDOFF':'UNDERWRITING TO MEDICAL SUMMARY',headline=analysis?'Analysis and Pricing Agents are working together':'Underwriting is handing off to the Medical Summary Agent',kind=analysis?'analysis':'underwriting';
 return `<div class="message bot agent-response-work paired-specialist-work ${kind}-orchestration-work" data-agent-work="${work.agentId}" role="status" aria-live="polite"><span class="conversation-avatar agent-avatar">${icon(nodes[activeAgent].icon)}</span><div class="paired-specialist-bubble"><header><span><small>${eyebrow}</small><strong>${headline}</strong></span><em>${progress}%</em></header><div class="paired-agent-handshake">${nodes.map((node,index)=>`<div class="paired-agent ${index<activeAgent?'complete':index===activeAgent?'active':'queued'}"><div class="paired-agent-visual"><span></span><i>${index<activeAgent?icon('check'):icon(node.icon)}</i><b></b></div><strong>${node.name}</strong><small>${index<activeAgent?'Handoff complete':index===activeAgent?'Working now':'Ready to receive'}</small></div>${index===0?`<div class="paired-handoff ${activeAgent===0?'active':'complete'}"><span></span>${icon('arrow')}<small>secure handoff</small></div>`:''}`).join('')}</div><div class="paired-live-message"><span>${icon(nodes[activeAgent].icon)}</span><div><small>NOW HAPPENING</small><strong>${nodes[activeAgent].name}</strong><p>${esc(steps[activeStep]?.detail||nodes[activeAgent].detail)}</p></div></div><div class="document-work-progress"><i style="width:${progress}%"></i></div></div></div>`;
}

function recommendationSequenceWorkingMarkup(chat,work){
 const duration=workDuration(work),elapsed=Math.max(0,performance.now()-work.startedAt),progress=Math.min(100,Math.round(elapsed/duration*100)),steps=work.customSteps||[],active=Math.min(steps.length-1,Number(work.sequenceIndex)||0),nodes=[{icon:'spark',name:'Recommendation Agent'},{icon:'sliders',name:'Analysis Agent'},{icon:'spark',name:'Recommendation Agent'}];
 return `<div class="message bot agent-response-work recommendation-sequence-work" data-agent-work="${work.agentId}" role="status" aria-live="polite"><span class="conversation-avatar agent-avatar">${icon('spark')}</span><div class="recommendation-sequence-bubble"><header><small>POLICY RECOMMENDATION ORCHESTRATION</small><strong>Three specialists are handing off your profile</strong><em>${progress}%</em></header><div class="recommendation-sequence-graph">${nodes.map((node,index)=>`<div class="sequence-agent ${index<active?'complete':index===active?'active':'queued'}"><span>${index<active?icon('check'):icon(node.icon)}</span><strong>${node.name}</strong><small>${index<active?'Handoff complete':index===active?'Working now':'Ready'}</small></div>${index<nodes.length-1?`<div class="sequence-link ${index<active?'complete':index===active?'active':''}"><i></i>${icon('arrow')}</div>`:''}`).join('')}</div><div class="sequence-live-message"><span>${icon(nodes[active].icon)}</span><div><small>NOW HAPPENING</small><strong>${esc(steps[active]?.title||nodes[active].name)}</strong><p>${esc(steps[active]?.detail||'Preparing your policy recommendation.')}</p></div></div><div class="document-work-progress"><i style="width:${progress}%"></i></div></div></div>`;
}

function workingMarkup(chat){
 const work=chat.agentWork,agent=agents[work.agentId-1];
 if(work.documentWorkflow)return documentWorkingMarkup(chat,work);
 if(work.recommendationSequence)return recommendationSequenceWorkingMarkup(chat,work);
 if(work.analysisWorkflow||work.underwritingWorkflow)return pairedSpecialistWorkingMarkup(chat,work);
 if(work.recommendationWorkflow)return specialistWorkingMarkup(chat,work);
 return `<div class="message bot agent-response-work" data-agent-work="${agent.id}" role="status" aria-live="polite"><span class="conversation-avatar agent-avatar">${icon(agent.icon)}</span><div class="agent-work-bubble"><div class="agent-work-visual"><span class="agent-work-ring"></span><span class="agent-work-scan"></span><i>${icon(agent.icon)}</i></div><div class="agent-work-copy"><small>${copy(chat,'SPECIALIST WORKING','الوكيل المتخصص يعمل الآن')}</small><strong>${esc(copy(chat,agent.name,agent.ar))}</strong><span class="thinking-label">${esc(work.title)}</span><p>${esc(work.detail)}</p><div class="agent-work-phases">${work.phases.map((phase,index)=>`<span style="--phase:${index}"><i></i>${esc(phase)}</span>`).join('')}</div></div></div></div>`;
}

function applyWorkingState(chat,dialogue){
 dialogue.querySelectorAll('.thinking-message:not([data-agent-work])').forEach(node=>node.remove());
 const work=chat.agentWork;if(work?.status!=='running')return;
 const messages=dialogue.querySelector('.messages'),rows=[...(messages?.querySelectorAll(':scope > .message')||[])];
 rows.forEach((row,index)=>{if(index>=work.hiddenFrom&&chat.state.messages?.[index]?.role==='bot')row.classList.add('agent-response-buffered');});
 const content=dialogue.querySelector('.chat-content');if(content&&!work.nonBlocking)content.classList.add('agent-content-buffered');
 messages?.insertAdjacentHTML('beforeend',workingMarkup(chat));const inserted=messages?.querySelector('[data-agent-work]:last-of-type');if(inserted)inserted.dataset.renderKey=workRenderKey(work);
 dialogue.querySelectorAll('#message-form input,#message-form button').forEach(control=>{control.disabled=true;control.setAttribute('aria-disabled','true');});
 if((work.sequenceIndex||0)===0)requestAnimationFrame(()=>dialogue.querySelector('[data-agent-work]')?.scrollIntoView({block:'nearest',behavior:'smooth'}));
}

function paintAgentWork(chat){
 const dialogue=chat.host.querySelector('.agentic-dialogue');if(dialogue){dialogue.querySelectorAll('[data-agent-work]').forEach(node=>node.remove());applyWorkingState(chat,dialogue);}const status=chat.host.querySelector('.chat-heading .ready');if(status)status.innerHTML=`<i></i>${copy(chat,'Working','يعمل الآن')}`;chat.refreshAgentWorkspace?.();
}

function finishAgentWork(chat,completed,{reopenCalculator=false,focusInput=false}={}){
 rememberAgentRun(chat,completed);completeActivity(chat,completed);chat.lastAgentRun=completed;chat.agentWork=null;chat.state.aiPending=false;chat.workKind=null;chat.persist();if(completed.analysisWorkflow)chat.host.querySelectorAll('.calculator-analysis-hidden').forEach(calculator=>calculator.classList.remove('calculator-analysis-hidden'));const dialogue=chat.host.querySelector('.agentic-dialogue');if(!dialogue){chat.render();return;}
 dialogue.querySelectorAll('[data-agent-work]').forEach(node=>node.remove());dialogue.querySelectorAll('.agent-response-buffered').forEach(node=>node.classList.remove('agent-response-buffered'));dialogue.querySelector('.agent-content-buffered')?.classList.remove('agent-content-buffered');const disabled=['guest','login','register'].includes(chat.state.stage)||chat.state.searching||chat.state.startingGuest;dialogue.querySelectorAll('#message-form input,#message-form button').forEach(control=>{control.disabled=disabled;control.toggleAttribute('aria-disabled',disabled);});const status=chat.host.querySelector('.chat-heading .ready');if(status)status.innerHTML=`<i></i>${copy(chat,'Ready','جاهز')}`;chat.refreshAgentWorkspace?.();if(reopenCalculator)requestAnimationFrame(()=>chat.host.querySelector('[data-insurance-calculator]')?.click());else requestAnimationFrame(()=>{const conversation=dialogue.querySelector('#conversation'),latestBot=[...dialogue.querySelectorAll('.messages .message.bot')].at(-1);if(conversation&&latestBot){const offset=latestBot.getBoundingClientRect().top-conversation.getBoundingClientRect().top,behavior=conversation.style.scrollBehavior;conversation.style.scrollBehavior='auto';conversation.scrollTop=Math.max(0,conversation.scrollTop+offset);conversation.style.scrollBehavior=behavior;}if(focusInput)chat.host.querySelector('#chat-input')?.focus({preventScroll:true});});
}

function enforceFinalReviewAgent(chat){
 if(flowStage(chat)!=='purchase')return;
 const runningRecommendation=chat.agentWork?.status==='running'&&(chat.agentWork.agentId===5||chat.agentWork.recommendationWorkflow||chat.agentWork.recommendationSequence);if(runningRecommendation){chat.agentWorkSequence++;chat.agentWork=null;chat.state.aiPending=false;chat.workKind=null;}
 const staleRecommendation=!chat.lastAgentRun||chat.lastAgentRun.agentId===5||chat.lastAgentRun.recommendationWorkflow||chat.lastAgentRun.recommendationSequence;if(staleRecommendation){const summaryEvent=activityHistory(chat).find(event=>event.id===chat.state.medicalSummary?.activityId)||[...activityHistory(chat)].reverse().find(event=>event.type==='underwriting-medical-summary'),steps=summaryEvent?.steps||[{title:'Final policy review prepared',detail:'The selected policy, applicant profile and medical summary are ready for confirmation.'}];chat.lastAgentRun={agentId:4,status:'complete',underwritingWorkflow:true,prompt:'Final underwriting and medical summary review',title:'Policy request review prepared',customSteps:steps,activityId:summaryEvent?.id,durationMs:summaryEvent?.durationMs||UNDERWRITING_HANDOFF_MS,completedAt:summaryEvent?.completedAt||Date.now()};}
 if(runningRecommendation)chat.persist();
}

function buildWorkspace(chat){
 const panel=chat.host.querySelector('.chat-panel');
 document.body.classList.toggle('agentic-workspace-open',Boolean(panel));
 if(!panel)return;
 enforceFinalReviewAgent(chat);
 ensureEmploymentTimer(chat);
 ensureMedicalDocumentTimer(chat);
 const current=activeStage(chat);
 if(chat.state.agentActiveStage!==current){chat.state.agentActiveStage=current;chat.state.agentPanelStage=current;}
 panel.classList.add('agentic-shell');panel.classList.toggle('agent-panel-open',Boolean(chat.state.agentPanelOpen));panel.dataset.activeAgent=String(current);panel.classList.toggle('agent-is-working',chat.agentWork?.status==='running');
 const header=panel.querySelector('.chat-header'),heading=header?.querySelector('.chat-heading');
 if(heading){heading.innerHTML=`<strong>Himaya <span lang="ar">حماية</span></strong>`;}
 const language=panel.querySelector('.language-toggle');
 if(language&&!panel.querySelector('[data-agent-panel-toggle]'))language.insertAdjacentHTML('beforebegin',`<button class="agent-panel-toggle" data-agent-panel-toggle aria-label="${copy(chat,'Show agent activity','عرض نشاط الوكلاء')}"><span><i></i>${icon('spark')}</span>${copy(chat,'Agents','الوكلاء')}</button>`);
 const appbar=document.createElement('div');appbar.innerHTML=appbarMarkup(chat);const appbarNode=appbar.firstElementChild;
 const body=document.createElement('div');body.className='agentic-body';
 const dialogue=document.createElement('main');dialogue.className='agentic-dialogue';dialogue.dataset.activeAgent=String(current);
 [header,panel.querySelector('.chat-demo-strip'),panel.querySelector('.chat-status-anchor'),panel.querySelector('.advisor-status'),panel.querySelector('.conversation'),panel.querySelector('.message-form'),panel.querySelector('.chat-brand')].filter(Boolean).forEach(node=>dialogue.append(node));
 const brand=dialogue.querySelector('.chat-brand');if(brand)brand.textContent=copy(chat,'Proof of concept · recommendations and payments are simulated','نموذج تجريبي · التوصيات والمدفوعات محاكاة');
 applyWorkingState(chat,dialogue);
 const aside=document.createElement('aside');aside.className='agentic-sidebar';aside.setAttribute('aria-label',copy(chat,'Live agent activity','نشاط الوكلاء المباشر'));aside.innerHTML=workspaceMarkup(chat);aside.dataset.renderKey=workspaceRenderKey(chat);
 body.append(dialogue,aside);panel.replaceChildren(appbarNode,body);
}

function inspectDocument(chat,file,context=''){
 const structured=context&&typeof context==='object'&&!Array.isArray(context)?context:null,source=`${structured?.identityNumber||context||''} ${file?.name||''}`,groups=source.match(/\d+/g)||[],candidate=groups.sort((a,b)=>b.length-a.length)[0]||'',digits=candidate.replace(/\D/g,'');
 let result;
 if(structured){const errors=[...(structured.errors||[])],id=String(structured.identityNumber||'').trim(),mobile=String(structured.mobile||'').trim();if(!errors.length&&!/^2\d{9}$/.test(id))errors.push('National ID / Iqama must contain exactly 10 digits and start with 2.');if(!errors.length&&!/^05\d{8}$/.test(mobile))errors.push('Mobile number must contain exactly 10 digits and start with 05.');result=errors.length?{status:'invalid',title:'Document scanning and validation failed',titleAr:'فشل مسح المستند والتحقق منه',message:errors.join(' '),messageAr:errors.join(' ')}:{status:'valid',title:'Document scanned and validated',titleAr:'تم مسح المستند والتحقق منه',message:`Document Scanning and Validation Agent filled ${Number(structured.extractedCount)||0} fields. ID ending ${id.slice(-4)} and mobile ending ${mobile.slice(-4)} passed format validation.`,messageAr:`قام وكيل مسح المستندات والتحقق منها بتعبئة ${Number(structured.extractedCount)||0} حقول. اجتازت الهوية والجوال التحقق من الصيغة.`};}
 else if(digits){
  const valid=/^2\d{9}$/.test(digits);
  result=valid?{status:'valid',title:'Identity format verified',titleAr:'تم التحقق من صيغة الهوية',message:`Document Scanning and Validation Agent found a valid 10-digit ID format ending ${digits.slice(-4)}.`,messageAr:`وجد وكيل مسح المستندات والتحقق منها صيغة هوية صالحة تنتهي بـ ${digits.slice(-4)}.`}:{status:'invalid',title:'Document scanning and validation failed',titleAr:'فشل مسح المستند والتحقق منه',message:'National ID / Iqama must contain exactly 10 digits and start with 2.',messageAr:'يجب أن يتكون رقم الهوية الوطنية / الإقامة من 10 أرقام بالضبط وأن يبدأ بالرقم 2.'};
 }else if(String(context||'').trim())result={status:'invalid',title:'Document scanning and validation failed',titleAr:'فشل مسح المستند والتحقق منه',message:'National ID / Iqama must contain exactly 10 digits and start with 2.',messageAr:'يجب أن يتكون رقم الهوية الوطنية / الإقامة من 10 أرقام بالضبط وأن يبدأ بالرقم 2.'};
 else result={status:'scanning',title:'Document review in progress',titleAr:'مراجعة المستند قيد التنفيذ',message:'Document received. Confirm the 10-digit ID beginning with 2 and the 10-digit mobile beginning with 05.',messageAr:'تم استلام المستند. أكد رقم الهوية المكون من 10 أرقام ويبدأ بـ 2 ورقم الجوال المكون من 10 أرقام ويبدأ بـ 05.'};
 if(structured&&!structured.errors?.length){const id=String(structured.identityNumber||'').trim(),mobile=String(structured.mobile||'').trim(),idValid=/^2\d{9}$/.test(id),mobileValid=/^05\d{7}$/.test(mobile),errors=[];if(!idValid)errors.push('National ID / Iqama must contain exactly 10 digits and start with 2.');if(!mobileValid)errors.push('Mobile number must contain exactly 9 digits and start with 05.');result=errors.length?{status:'invalid',title:'Document scanning and validation failed',titleAr:'Document scanning and validation failed',message:errors.join(' '),messageAr:errors.join(' ')}:{status:'valid',title:'Document scanned and validated',titleAr:'Document scanned and validated',message:`Document Scanning and Validation Agent filled ${Number(structured.extractedCount)||0} fields. ID ending ${id.slice(-4)} and mobile ending ${mobile.slice(-4)} passed format validation.`,messageAr:`Document Scanning and Validation Agent filled ${Number(structured.extractedCount)||0} fields. ID ending ${id.slice(-4)} and mobile ending ${mobile.slice(-4)} passed format validation.`};}
 chat.state.agentInteractionStarted=true;chat.state.agentDocumentCheck={...result,fileName:file?.name||'',checkedAt:Date.now()};chat.state.agentPanelStage=2;chat.agentWork=orchestratedWork(chat,[2],file?.name||'');chat.agentWork.documentWorkflow=true;chat.agentWork.demoDurationMs=DOCUMENT_AGENT_WORK_MS;const documentEvent=beginActivity(chat,chat.agentWork,{type:'document',title:'Identity document orchestration'}),profile=currentPlanningSnapshot(chat);documentEvent.risk=ageRisk(profile.age);documentEvent.metrics=[{label:'Document',value:file?.name||'Identity evidence'},{label:'Age',value:profile.age||'—'},{label:'Fields extracted',value:Number(structured?.extractedCount)||0},{label:'Validation',value:result.status==='valid'?'Passed':result.status==='invalid'?'Needs attention':'In progress'}];chat.persist();paintAgentWork(chat);
 const token=++chat.agentWorkSequence;scheduleWorkspaceProgress(chat,token);setTimeout(()=>{if(chat.agentWorkSequence!==token)return;const completed={...chat.agentWork,status:'complete',durationMs:DOCUMENT_AGENT_WORK_MS,completedAt:Date.now()};finishAgentWork(chat,completed);if(result.status==='valid')startEmploymentVerification(chat,file?.name||'');},DOCUMENT_AGENT_WORK_MS);
 return result;
}

function decorateHistoryIcons(chat,aside){
 const working=chat.agentWork?.status==='running',employment=chat.state.employmentVerification,medical=chat.state.medicalDocumentIntelligence,activeRun=working?activityHistory(chat).find(event=>event.id===chat.agentWork?.activityId):null,excluded=new Set([activeRun?.id,employment?.status==='running'?employment.activityId:null,medical?.status==='running'?medical.activityId:null].filter(Boolean)),visible=[...activityHistory(chat)].filter(event=>!excluded.has(event.id)).reverse();
 aside?.querySelectorAll('.agent-history-version').forEach((details,index)=>{const mark=details.querySelector('.history-version-mark'),event=visible[index],owner=eventAgents(event||{})[0]||agents[0];if(!mark)return;const holder=document.createElement('i');holder.innerHTML=icon(owner.icon);mark.replaceChildren(holder);mark.title=owner.name;mark.setAttribute('aria-hidden','true');});
}

export function installAgenticWorkspace(Chat){
 const previousRender=Chat.prototype.render,previousClick=Chat.prototype.click,previousChange=Chat.prototype.change,previousSubmit=Chat.prototype.submit,previousCommit=Chat.prototype.commitDocumentMessage,previousSendAdvice=Chat.prototype.sendAdvice;
 Chat.prototype.agentWorkSequence=0;
 Chat.prototype.refreshAgentWorkspace=function(){
  const current=activeStage(this),panel=this.host.querySelector('.agentic-shell'),dialogue=this.host.querySelector('.agentic-dialogue'),aside=this.host.querySelector('.agentic-sidebar'),content=aside?.querySelector('.agent-commentary-content'),scrollTop=content?.scrollTop||0,liveKey=workRenderKey(this.agentWork),asideKey=workspaceRenderKey(this);
  if(panel){panel.dataset.activeAgent=String(current);panel.classList.toggle('agent-is-working',this.agentWork?.status==='running');}
  if(dialogue){dialogue.dataset.activeAgent=String(current);const live=dialogue.querySelector('[data-agent-work]');if(live&&this.agentWork?.status==='running'&&live.dataset.renderKey!==liveKey){const replacement=document.createElement('div');replacement.innerHTML=workingMarkup(this);const node=replacement.firstElementChild;node.dataset.renderKey=liveKey;live.replaceWith(node);}}
  if(aside&&aside.dataset.renderKey!==asideKey){aside.innerHTML=workspaceMarkup(this);aside.dataset.renderKey=asideKey;decorateHistoryIcons(this,aside);const next=aside.querySelector('.agent-commentary-content');if(next)next.scrollTop=scrollTop;}
  const verification=this.state.employmentVerification,elapsedNode=aside?.querySelector('[data-employment-elapsed]');if(verification?.status==='running'&&elapsedNode){const elapsedSeconds=Math.min(Math.floor(EMPLOYMENT_VERIFICATION_MS/1000),Math.floor(Math.max(0,Date.now()-verification.startedAt)/1000)),targetSeconds=Math.floor(EMPLOYMENT_VERIFICATION_MS/1000);elapsedNode.textContent=`${copy(this,'Elapsed','المنقضي')} ${Math.floor(elapsedSeconds/60)}:${String(elapsedSeconds%60).padStart(2,'0')} / ${Math.floor(targetSeconds/60)}:${String(targetSeconds%60).padStart(2,'0')}`;}
  const medical=this.state.medicalDocumentIntelligence,medicalElapsedNode=aside?.querySelector('[data-medical-elapsed]');if(medical?.status==='running'&&medicalElapsedNode){const elapsedSeconds=Math.min(Math.floor(MEDICAL_DOCUMENT_INTELLIGENCE_MS/1000),Math.floor(Math.max(0,Date.now()-medical.startedAt)/1000)),targetSeconds=Math.floor(MEDICAL_DOCUMENT_INTELLIGENCE_MS/1000);medicalElapsedNode.textContent=`${copy(this,'Elapsed','المنقضي')} ${Math.floor(elapsedSeconds/60)}:${String(elapsedSeconds%60).padStart(2,'0')} / ${Math.floor(targetSeconds/60)}:${String(targetSeconds%60).padStart(2,'0')}`;}
 };
 Chat.prototype.inspectNationalIdDocument=function(file,context=''){return inspectDocument(this,file,context);};
 Chat.prototype.startCalculatorAnalysis=function(key,snapshot={},onComplete){
  this.calculatorAnalysisCallbacks||(this.calculatorAnalysisCallbacks=new Set());if(onComplete)this.calculatorAnalysisCallbacks.add(onComplete);
  if(this.agentWork?.status==='running'&&this.agentWork.analysisWorkflow){updateAnalysisAgent(this,key,snapshot);return this.agentWork;}
  this.pendingCalculatorAnalysis={key,snapshot:{...snapshot}};clearTimeout(this.calculatorAnalysisDebounce);this.calculatorAnalysisDebounce=setTimeout(()=>{const pending=this.pendingCalculatorAnalysis;if(!pending)return;this.pendingCalculatorAnalysis=null;startAnalysisAgent(this,pending.key,pending.snapshot,()=>{const callbacks=[...(this.calculatorAnalysisCallbacks||[])];this.calculatorAnalysisCallbacks?.clear();callbacks.forEach(callback=>callback());});},320);
 };
 Chat.prototype.updateCalculatorAnalysis=function(key,snapshot={}){if(this.pendingCalculatorAnalysis)this.pendingCalculatorAnalysis={key:key||this.pendingCalculatorAnalysis.key,snapshot:{...this.pendingCalculatorAnalysis.snapshot,...snapshot}};updateAnalysisAgent(this,key,snapshot);};
 Chat.prototype.startPolicySelectionAnalysis=function(plan={},onComplete){return startPolicySelectionAnalysis(this,plan,onComplete);};
 Chat.prototype.startMedicalDocumentIntelligence=function(files=[]){return startMedicalDocumentIntelligence(this,files);};
 Chat.prototype.render=function(){previousRender.call(this);buildWorkspace(this);};
 Chat.prototype.sendAdvice=async function(text,options={}){
  if(this.agentWork?.status==='running'||this.state.aiPending)return;
  this.state.agentInteractionStarted=true;const sequence=orchestrationForMessage(this,text),token=++this.agentWorkSequence,work=orchestratedWork(this,sequence,text),started=performance.now();this.agentWork=work;this.state.agentPanelStage=work.agentId;beginActivity(this,work);
  let result,error;const task=previousSendAdvice.call(this,text,options),calculatorRequested=Boolean(this.host.querySelector('#insurance-calculator'));this.state.aiPending=true;this.workKind='agent-transition';paintAgentWork(this);scheduleWorkspaceProgress(this,token);
  try{result=await task;}catch(caught){error=caught;}
  if(token!==this.agentWorkSequence){if(error)throw error;return result;}
  this.state.aiPending=true;this.workKind='agent-transition';paintAgentWork(this);await wait(Math.max(0,MINIMUM_AGENT_WORK_MS-(performance.now()-started)));const reopenCalculator=calculatorRequested||Boolean(this.host.querySelector('#insurance-calculator'));
  if(token===this.agentWorkSequence){const completed={...this.agentWork,status:'complete',durationMs:Math.round(performance.now()-started),completedAt:Date.now()};finishAgentWork(this,completed,{reopenCalculator,focusInput:true});}
  if(error)throw error;return result;
 };
 Chat.prototype.click=async function(event){
  const stage=event.target.closest('[data-agent-stage]');if(stage){this.state.agentPanelStage=Number(stage.dataset.agentStage);this.persist();this.refreshAgentWorkspace();return;}
  if(event.target.closest('[data-agent-panel-toggle]')){this.state.agentPanelOpen=!this.state.agentPanelOpen;this.host.querySelector('.agentic-shell')?.classList.toggle('agent-panel-open',this.state.agentPanelOpen);return;}
  const nav=event.target.closest('[data-agent-nav]');if(nav){const action=nav.dataset.agentNav;if(action==='home'){this.toggle(false);return;}if(action==='renew'){this.state.existingIntent='renew';this.state.entrySource='chat';this.state.stage='login';this.state.purchaseFlow=null;this.state.loginError=null;this.persist();this.render();return;}this.host.querySelector('#chat-input')?.focus({preventScroll:true});return;}
  const restart=event.target.closest('[data-action="restart"]');if(restart){const previousState=this.state,result=previousClick.call(this,event);if(this.state!==previousState){this.agentWorkSequence++;this.agentWork=null;this.lastAgentRun=null;this.workKind=null;this.state.aiPending=false;this.state.agentInteractionStarted=false;this.state.agentRunHistory=[];this.state.agentActivityHistory=[];delete this.state.employmentVerification;delete this.state.medicalDocumentIntelligence;clearTimeout(this.employmentVerificationTimer);clearTimeout(this.medicalDocumentTimer);clearTimeout(this.calculatorAnalysisDebounce);this.employmentVerificationTimer=null;this.medicalDocumentTimer=null;this.calculatorAnalysisDebounce=null;this.pendingCalculatorAnalysis=null;delete this.state.agentPanelStage;delete this.state.agentActiveStage;this.persist();this.render();}return result;}
  const entrySetup=event.target.closest('[data-journey],[data-new-path]');if(entrySetup){this.agentWorkSequence++;this.agentWork=null;this.lastAgentRun=null;this.workKind=null;this.state.aiPending=false;this.state.agentInteractionStarted=false;this.state.agentRunHistory=[];this.state.agentActivityHistory=[];delete this.state.employmentVerification;delete this.state.medicalDocumentIntelligence;clearTimeout(this.employmentVerificationTimer);clearTimeout(this.medicalDocumentTimer);clearTimeout(this.calculatorAnalysisDebounce);this.employmentVerificationTimer=null;this.medicalDocumentTimer=null;this.calculatorAnalysisDebounce=null;this.pendingCalculatorAnalysis=null;delete this.state.agentPanelStage;delete this.state.agentActiveStage;const value=previousClick.call(this,event);this.persist();return value;}
 const exploreSetup=event.target.closest('[data-explore-view],[data-explore-journey],[data-exit-life],[data-back-directions],[data-main-journeys],[data-back-entry]');if(exploreSetup){this.agentWorkSequence++;this.agentWork=null;this.state.aiPending=false;this.workKind=null;const value=previousClick.call(this,event);this.persist();return value;}
 const loginNavigation=event.target.closest('[data-existing-path],[data-open-login],[data-entry="existing"]');if(loginNavigation){this.agentWorkSequence++;this.agentWork=null;this.state.aiPending=false;this.workKind=null;const value=previousClick.call(this,event);this.persist();return value;}
 const certificateAction=event.target.closest('[data-payment-demo],[data-download-certificate]');if(certificateAction){this.agentWorkSequence++;this.agentWork=null;this.state.aiPending=false;this.workKind=null;const value=previousClick.call(this,event);this.persist();return value;}
  const underwritingAction=event.target.closest('[data-continue-buy],[data-personalized-buy]');if(underwritingAction){if(this.agentWork?.underwritingWorkflow)return;startUnderwritingHandoff(this,()=>previousClick.call(this,event));return;}
  const transition=selectionTransition(event),hiddenFrom=this.state.messages?.length||0,started=performance.now();if(transition)this.state.agentInteractionStarted=true;const result=previousClick.call(this,event);
  if(!transition)return result;
  const token=++this.agentWorkSequence,work=orchestratedWork(this,transition.sequence,transition.prompt);work.hiddenFrom=hiddenFrom;work.nonBlocking=Boolean(transition.nonBlocking);this.agentWork=work;this.state.agentPanelStage=work.agentId;this.state.aiPending=!work.nonBlocking;this.workKind='agent-transition';beginActivity(this,work);paintAgentWork(this);scheduleWorkspaceProgress(this,token);
  let error,value;try{value=await result;}catch(caught){error=caught;}
  await wait(Math.max(0,MINIMUM_AGENT_WORK_MS-(performance.now()-started)));
  if(token===this.agentWorkSequence){const completed={...this.agentWork,status:'complete',durationMs:Math.round(performance.now()-started),completedAt:Date.now()};finishAgentWork(this,completed,{focusInput:true});}
  if(error)throw error;return value;
 };
 Chat.prototype.submit=async function(event){
  if(event.target.id==='login-form'){this.agentWorkSequence++;this.agentWork=null;this.state.aiPending=false;this.workKind=null;return previousSubmit.call(this,event);}
  this.state.agentInteractionStarted=true;const profileForm=event.target.id==='customer-profile-form',hiddenFrom=this.state.messages?.length||0,started=performance.now(),result=previousSubmit.call(this,event);let value,error;try{value=await result;}catch(caught){error=caught;}
  const recommendations=profileForm&&this.state.stage==='explore'&&this.state.purchaseFlow?.stage==='recommendations',purchase=profileForm&&this.state.stage==='explore'&&this.state.purchaseFlow?.stage==='purchase';if(!recommendations&&!purchase){if(error)throw error;return value;}
  const sequence=recommendations?[5,4,5]:[3,6],prompt=recommendations?copy(this,'Find my strongest policy matches','اعرض أقوى الوثائق المطابقة لي'):copy(this,'Prepare my application for payment','جهز طلبي للدفع'),token=++this.agentWorkSequence,work=orchestratedWork(this,sequence,prompt);work.hiddenFrom=hiddenFrom;if(recommendations){work.demoDurationMs=POLICY_RECOMMENDATION_SEQUENCE_MS;work.recommendationSequence=true;work.customSteps=[{title:'Policy recommendation',detail:'Recommendation Agent ranks policy fit using age, salary, dependants, cover goals and term.'},{title:'Analysing prices and policies',detail:'Analysis Agent compares premiums, target cover, affordability and plan constraints across the shortlist.'},{title:'Recommending best add-ons',detail:'Recommendation Agent selects the most relevant optional benefits and includes them with each policy card.'}];}this.agentWork=work;this.state.agentPanelStage=work.agentId;this.state.aiPending=true;this.workKind='agent-transition';const activity=beginActivity(this,work,{title:recommendations?'Policy recommendation orchestration':undefined});if(recommendations){activity.steps=work.customSteps;activity.plannedDurationMs=POLICY_RECOMMENDATION_SEQUENCE_MS;const cards=[...this.host.querySelectorAll('.primary-detail-list>.synthetic-plan-card')].slice(0,2);activity.recommendationResults=cards.map((card,index)=>({label:index===0?'Recommended policy':'Top seller',name:card.querySelector('.synthetic-plan-title strong')?.textContent?.trim()||`Policy ${index+1}`,detail:[...card.querySelectorAll('.synthetic-plan-metrics b')].map(node=>node.textContent.trim()).join(' · ')}));}paintAgentWork(this);scheduleWorkspaceProgress(this,token);await wait(Math.max(0,workDuration(work)-(performance.now()-started)));
  if(token===this.agentWorkSequence){const completed={...this.agentWork,status:'complete',durationMs:Math.round(performance.now()-started),completedAt:Date.now()};finishAgentWork(this,completed);}
  if(error)throw error;return value;
 };
 Chat.prototype.change=function(event){if(event.target.id==='document-upload-input'){const file=event.target.files?.[0];if(file)inspectDocument(this,file,'');}return previousChange.call(this,event);};
 Chat.prototype.commitDocumentMessage=function(form){if(this.pendingAttachment){const context=form.elements.message.value.trim();inspectDocument(this,this.pendingAttachment,context);}return previousCommit.call(this,form);};
}
