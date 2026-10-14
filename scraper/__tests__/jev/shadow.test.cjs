'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const shadow=require('../../src/jev-weger-shadow.cjs'),base=require('../../src/jev-experiment-lib.cjs'),lib=require('../../src/jev-followup-lib.cjs');
const document=id=>({raw_item_id:id,source_id:168,title:'Openbaar projectstuk',url:'https://api.notubiz.nl/document/'+id+'/1',published_at:'2026-10-14',source_hash:'hash',metadata:{authority:'gemeente:amersfoort'},passages:[{start:0,end:50,text:'Projectstuk met test @example.nl en 06 1234 5678.'}]});
test('paarvragen bevatten alleen broninformatie en houden de eerdere modelcriteria gelijk',()=>{
  const p={documents:[document(1),document(2)],reference:{relation:'GEHEIM_OORDEEL',reason:'GEHEIME_REDEN'}};
  const req=shadow.pairRequest(p);assert.ok(!JSON.stringify(req).includes('GEHEIM'));assert.ok(!JSON.stringify(req).includes('@example'));
  assert.ok(!JSON.stringify(req).includes('1234 5678'));assert.equal(req.state.document_a.passages[0].start,0);
  assert.deepEqual(req.questions,lib.requestFor({a:{title:'',body:''},b:{title:'',body:''}}).questions);
});
test('met/zonder varieert alleen de extra documentcontext, niet de oorspronkelijke bronitems',()=>{
  const state={signal:{id:1,title:'Project'},items:[{id:7,content:'Bron'}],document_context:[{raw_item_id:8,passages:[{text:'Partner'}]}]};
  const a=shadow.actionRequest(state,false),b=shadow.actionRequest(state,true),{document_context,...plain}=b.state;
  assert.deepEqual(a.state,plain);assert.deepEqual(a.questions,b.questions);assert.equal(document_context.length,1);
  assert.deepEqual(shadow.actionRequest({...state,document_context:[]},true),shadow.actionRequest({...state,document_context:[]},false));
});
test('schaduwoordeel valideert labels, kansverdeling, modelversie en inputtokens',()=>{
  const choice=(options,k)=>({type:'choice',choice:k,confidence:1,probabilities:Object.fromEntries(Object.keys(options).map(x=>[x,Number(x===k)]))});
  const response=()=>({model:base.MODEL,usage:{input_tokens:1500},answers:{action:choice(shadow.ACTIONS,'watching'),source_gate:choice(shadow.GATES,'supported'),content_evidence:{type:'noul',noul:0.5}}});
  assert.equal(shadow.validate(response(),'signal').cost_usd,1500*base.PRICE);
  const bad=response();bad.answers.action.choice='publiceer';assert.throws(()=>shadow.validate(bad,'signal'));
  const drift=response();drift.model='jev-latest';assert.throws(()=>shadow.validate(drift,'signal'));
  const missing=response();missing.usage.input_tokens=0;assert.throws(()=>shadow.validate(missing,'signal'));
});
test('eerdere wegerstatus en reason verdwijnen; individuele briefinhoud blijft lokaal',()=>{
  const c={signal:{id:1,title:'Ingekomen klacht',summary:'Ontvangen',status:'discarded',weger_last_reviewed_at:'2026-10-14'},items:[{id:1,title:'Ingekomen klacht',url:'https://example.org/1',source:{tier:1},content:'PRIVE_BRIEFINHOUD',summary:'Metadata',content_length:100}],document_verbanden:[],recent_events:[{reason:'OUD_OORDEEL'}]};
  const state=shadow.stateFor(c,'2026-10-14',new Map());assert.ok(!JSON.stringify(state).includes('PRIVE_BRIEFINHOUD'));
  assert.ok(!JSON.stringify(state).includes('OUD_OORDEEL'));assert.ok(!Object.hasOwn(state.signal,'status'));assert.equal(state.items[0].privacy_minimized,true);
});
