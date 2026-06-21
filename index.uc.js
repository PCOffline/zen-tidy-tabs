// ==UserScript==
// @name           Zen Tidy Tabs
// @description    Arc-style AI tab tidying integrated into Zen's native sidebar.
//                 A hover-reveal "Tidy" control clusters the open tabs via an
//                 LLM (OpenRouter) into native Zen tab groups. Right-click a
//                 group label to rename / recolor it; left-click renames inline.
// @author         PCOffline
// @version        0.5.0
// @include        main
// ==/UserScript==
(()=>{var o={debug:!1,prefs:{apiKey:"zen-tidy-tabs.apikey",model:"zen-tidy-tabs.model",labelStyle:"zen-tidy-tabs.labelstyle",urlMode:"zen-tidy-tabs.urlmode"},api:{endpoint:"https://openrouter.ai/api/v1/chat/completions",defaultModel:"openai/gpt-4o-mini",maxTokens:2048,maxTokensCeiling:8192,tokensPerTab:24,tokensBuffer:256,temperature:0,seed:7,timeoutMs:9e4,errorBodyMaxChars:300,outputPreviewMaxChars:200,referer:"https://github.com/PCOffline/zen-tidy-tabs",title:"Zen Tidy Tabs"},ui:{controlId:"zen-tidy-tabs-button",styleId:"zen-tidy-tabs-style",overlayId:"zen-tidy-tabs-overlay",notificationValue:"zen-tidy-tabs-msg",label:"🧹 Tidy",busyLabel:"↻ Tidying…",tooltip:"Tidy tabs with AI",clearButtonClass:"zen-workspace-close-unpinned-tabs-button"},panel:{hideSaveAndClose:!0,overrideUngroup:!0,ids:{saveAndClose:"tabGroupEditor_saveAndCloseGroup",ungroup:"tabGroupEditor_ungroupTabs"}},grouping:{colors:["blue","red","yellow","green","pink","purple","cyan","orange","gray"],minTabs:3,minGroups:2,maxGroups:8,targetTabsPerGroup:3},snapshot:{titleMax:160,urlMax:120},timing:{emptyCheckDelayMs:80,emptyCheckIntervalMs:150,emptyCheckMaxTries:6,emptyWatcherDebounceMs:500,notifyDurationMs:6e3,mountRetryMs:250,mountMaxAttempts:40}};var Y="[Zen Tidy Tabs]",I=e=>{let t=`${Y} [${e}]`;return{info:(...n)=>console.info(t,...n),warn:(...n)=>console.warn(t,...n),error:(...n)=>console.error(t,...n),debug:(...n)=>{o.debug&&console.debug(t,...n)}}},i={init:I("Initialization"),config:I("Config"),dom:I("DOM"),styles:I("Styles"),ai:I("AI"),groups:I("Groups"),tidy:I("Tidy"),user:I("User Interaction"),diagnose:I("Diagnostics")};var F=(()=>{let e=typeof window>"u"?null:window;if(!e?.gBrowser)try{let t=Services.wm.getMostRecentWindow("navigator:browser");t?.gBrowser&&(e=t)}catch(t){i.init.error("Could not resolve a browser window via Services.wm; gBrowser is unavailable.",t)}return e?.gBrowser?{win:e,doc:e.document,gBrowser:e.gBrowser}:null})();if(!F){let e="No window with gBrowser found. Use the Browser Console (Ctrl+Shift+J) with devtools.chrome.enabled = true.";throw i.init.error(`Startup aborted: ${e}`),new Error(e)}var{win:m,doc:l,gBrowser:p}=F,B={};var X="tab, .tabbrowser-tab",W=e=>String(e??"").trim().toLowerCase(),G=e=>(e?.getAttribute?.("label")||e?.label||"").trim(),U=e=>e?.color??e?.getAttribute?.("color")??"",Z=e=>e.tabs||e.querySelectorAll(X),D=(e,t)=>{e.label=t,e.setAttribute("label",t)},q=(e,t)=>{e.color=t,e.setAttribute("color",t)},j="toolbarbutton, button, label, span, hbox, vbox, toolbaritem, div, image, [label], [tooltiptext]",H=e=>!!((e.getAttribute?.("label")??"").trim().toLowerCase()==="clear"||(e.textContent??"").trim().toLowerCase()==="clear"||e.children.length===0&&["::before","::after"].some(n=>{try{return/clear/i.test(getComputedStyle(e,n).content??"")}catch{return!1}})),f={activeWorkspaceEl(){return m.gZenWorkspaces?.activeWorkspaceElement||l.querySelector("zen-workspace[active]")||p.selectedTab?.closest?.(".zen-workspace-tabs-section")||l.querySelector("zen-workspace")},activeSection(){return p.selectedTab?.closest?.(".zen-workspace-tabs-section")||l.querySelector(".zen-workspace-tabs-section[active]")||l.querySelector(".zen-workspace-tabs-section")},clearControl(){let e=[f.activeWorkspaceEl(),f.activeSection(),l].filter(n=>!!n),t=new Set;for(let n of e)for(let r of n.querySelectorAll(j))if(!t.has(r)&&(t.add(r),H(r)))return r;return null},firstNormalNode(e){return Array.from(e.querySelectorAll("tab-group, tab, .tabbrowser-tab")).find(t=>f.isGroupEl(t)||!(t.pinned||t.hasAttribute?.("zen-essential")))??null},isGroupEl(e){return(e?.tagName??"").toLowerCase()==="tab-group"||e?.classList?.contains?.("tab-group")||!1},describe(e){return e?(e.tagName??"?").toLowerCase()+(e.id?`#${e.id}`:"")+(e.className?`.${String(e.className).trim().split(/\s+/)[0]}`:""):"null"}};var M={pseudo(e,t){try{return getComputedStyle(e,t).content??""}catch{return""}},path(e,t=8){let n=[],r=e;for(let a=0;r&&a<t;a++)n.unshift(f.describe(r)),r=r.parentElement;return n.join(" > ")},clearCandidates(){return[...l.querySelectorAll(j)].filter(H).map(e=>({el:e,text:(e.textContent??"").trim(),label:e.getAttribute?.("label")??"",tip:e.getAttribute?.("tooltiptext")??"",pseudo:e.children.length>0?"":M.pseudo(e,"::before")+M.pseudo(e,"::after")}))},newTabButton(){return(l.getElementById("tabs-newtab-button")||l.querySelector("[command='cmd_newNavigatorTab'], .tabs-newtab-button, #vertical-tabs-newtab-button")||[...l.querySelectorAll("toolbarbutton, button")].find(e=>/new tab/i.test(`${e.getAttribute("label")??""} ${e.textContent??""}`)))??null},run(){i.diagnose.info("DOM diagnosis start");let r=p.selectedTab;i.diagnose.info("selectedTab:",f.describe(r)),i.diagnose.info("  ancestry:",M.path(r));let a=f.activeSection();i.diagnose.info("activeSection:",f.describe(a)),a&&i.diagnose.info("  children:",[...a.children].map(d=>f.describe(d)).join("  |  ")),i.diagnose.info("firstNormalNode:",a?f.describe(f.firstNormalNode(a)):"n/a"),i.diagnose.info("clearControl() result:",f.describe(f.clearControl()));let s=M.clearCandidates();i.diagnose.info("'clear' candidates found:",s.length),s.slice(0,12).forEach((d,c)=>{i.diagnose.info(`  [${c}] ${f.describe(d.el)}`),i.diagnose.info(`       text="${d.text.slice(0,24)}" label="${d.label}" tip="${d.tip}" pseudo=${JSON.stringify(d.pseudo).slice(0,40)}`),i.diagnose.info(`       path: ${M.path(d.el,6)}`)});let u=M.newTabButton();i.diagnose.info("newTab button:",f.describe(u)),u?.parentElement&&(i.diagnose.info("  newTab siblings:",[...u.parentElement.children].map(d=>f.describe(d)).join("  |  ")),i.diagnose.info("  newTab parent path:",M.path(u.parentElement,6))),i.diagnose.info("DOM diagnosis end")}};var v={get(e,t=""){try{return Services.prefs.getStringPref(e,t)}catch{return t}},set(e,t){try{Services.prefs.setStringPref(e,t??""),i.config.debug(`Saved preference "${e}".`)}catch(n){i.config.error(`Failed to save preference "${e}".`,n)}},apiKey(){return v.get(o.prefs.apiKey)},model(){return v.get(o.prefs.model,o.api.defaultModel)},labelStyle(){return v.get(o.prefs.labelStyle,"filled")},urlMode(){let e=v.get(o.prefs.urlMode,"detailed");return["detailed","compact","minimal"].includes(e)?e:"detailed"}};var L={collect(e){let t=m.gZenWorkspaces?.activeWorkspace??null;return p.tabs.filter(n=>{if(n.pinned||n.hidden||n.closing||!e&&n.group||n.hasAttribute("zen-empty-tab")||n.hasAttribute("zen-glance-tab"))return!1;let r=n.getAttribute("zen-workspace-id");return!(t&&r&&r!==t)})},isAlive(e){return e&&!e.closing&&e.isConnected&&p.tabs.includes(e)},title(e){return(e.label??"").slice(0,o.snapshot.titleMax)},formatUrl(e,t){if(!e||t==="minimal")return"";if(t==="compact")try{return new URL(e).hostname}catch{return""}return(e.split("?")[0]??"").split("#")[0]?.slice(0,o.snapshot.urlMax)??""},snapshot(e){let t=v.urlMode();return e.map((n,r)=>{let a={i:r,title:L.title(n)},s=L.formatUrl(n.linkedBrowser?.currentURI?.spec??"",t);s&&(a.url=s);let u=G(n.group);return u&&(a.group=u),a})}};var k={create(e,t,n){typeof p.ungroupTab=="function"&&e.filter(s=>s.group).forEach(s=>{try{p.ungroupTab(s)}catch(u){i.groups.debug("Failed to detach a tab from its current group before regrouping:",u?.message)}});let r=e[0],a=[{label:t,color:n,insertBefore:r},{label:t,color:n},{label:t,color:n,isUserTriggered:!0}];for(let s of a)try{let u=p.addTabGroup(e,s);if(!u)continue;try{t&&D(u,t),n&&q(u,n)}catch{}return!0}catch(u){i.groups.debug(`addTabGroup attempt failed for group "${t}":`,u?.message)}return i.groups.error(`Failed to create tab group "${t}" after ${a.length} attempts (${e.length} tab(s)).`),!1},apply(e){if(typeof p.addTabGroup!="function")throw new Error("gBrowser.addTabGroup is unavailable in this Zen build.");return k.reconcile(e,k.existingFor(e))},existingFor(e){let t=new Map;for(let n of e)for(let r of n.tabs){if(!L.isAlive(r))continue;let a=r.group;if(!a)continue;let s=W(G(a));s&&!t.has(s)&&t.set(s,a)}return t},reconcile(e,t){let n={realized:0,failed:0},r=new Set,a=o.grouping.colors,s=0,u=()=>{for(let g=0;g<a.length;g++){let T=a[(s+g)%a.length];if(!r.has(T))return s+=g+1,r.add(T),T}let c=a[s%a.length];return s++,r.add(c),c},d=new Set(e.map(c=>W(c.name)));for(let[c,g]of t)d.has(c)||k.dissolve(g);for(let c of e){let g=t.get(W(c.name));g&&typeof g.addTabs=="function"&&r.add(U(g))}for(let c of e){let g=c.tabs.filter(L.isAlive),T=c.tabs.length-g.length;if(T&&i.groups.warn(`Group "${c.name}": ${T} tab(s) were closed during the tidy and will be skipped.`),g.length===0){i.groups.debug(`Group "${c.name}" has no live tabs after filtering; skipping.`);continue}let x=t.get(W(c.name));if(x&&typeof x.addTabs=="function"){let w=g.filter(h=>h.group!==x);if(w.length>0){i.groups.debug(`Reusing existing group "${c.name}" in place; adding ${w.length} tab(s).`);try{x.addTabs(w)}catch(h){i.groups.warn(`Failed to add tabs to existing group "${c.name}".`,h)}}n.realized++}else{let w=u();i.groups.debug(`Creating new group "${c.name}" with ${g.length} tab(s) (color: ${w}).`),k.create(g,c.name,w)?n.realized++:n.failed++}}return n},detachAndDissolve(e,t){let n=[...Z(e)].filter(L.isAlive);if(typeof p.ungroupTab=="function"&&n.forEach(r=>{try{p.ungroupTab(r)}catch(a){i.groups.debug(`Failed to detach a tab while ${t}:`,a?.message)}}),k.hasLiveTabs(e))return n.length;try{p.removeTabGroup(e)}catch(r){i.groups.debug(`removeTabGroup failed while ${t}:`,r?.message)}if(e.isConnected)try{e.remove()}catch{}return n.length},dissolve(e){try{e.label="",e.removeAttribute?.("label")}catch{}k.detachAndDissolve(e,"dissolving an abandoned group")},hasLiveTabs(e){return[...Z(e)].some(L.isAlive)},removeEmpty(){let e=f.activeSection()||l,t=0;for(let n of[...e.querySelectorAll("tab-group")])if(!k.hasLiveTabs(n)&&!n.querySelector?.(".zen-tidy-tabs-inline-editing"))try{typeof p.removeTabGroup=="function"?p.removeTabGroup(n):n.remove(),t++}catch(r){try{n.remove(),t++}catch{i.groups.warn("Could not remove an empty tab group via API or direct DOM removal.",r)}}return t&&i.groups.debug(`Removed ${t} empty group(s) from the active workspace.`),t},scheduleEmptyCheck(){let e=0,t=()=>{k.removeEmpty(),++e<o.timing.emptyCheckMaxTries&&setTimeout(t,o.timing.emptyCheckIntervalMs)};setTimeout(t,o.timing.emptyCheckDelayMs)},installEmptyWatcher(){m.__zenTidyTabsEmptyWatcher?.disconnect?.();let e=l.getElementById("tabbrowser-tabs")||l.documentElement,t=null,n=new MutationObserver(()=>{t||(t=setTimeout(()=>{t=null,k.removeEmpty()},o.timing.emptyWatcherDebounceMs))});n.observe(e,{childList:!0,subtree:!0}),m.__zenTidyTabsEmptyWatcher=n,i.groups.debug("Empty-group watcher installed on",`${f.describe(e)}.`)}};var A={buildPrompt(e){let t=e.length,n=t-1,r=Math.min(o.grouping.maxGroups,Math.max(o.grouping.minGroups,Math.ceil(t/o.grouping.targetTabsPerGroup))),s=e.some(u=>u.group)?`
- STABILITY: many tabs already have a "group" name. When a tab's current
group still makes sense, KEEP it there and reuse that exact name — do not
rename or reshuffle a sensible group just to change it. Prefer adding new
tabs into a fitting existing group over inventing a parallel one.
- REORGANIZE only with a clear reason: e.g. new tabs make a BROADER category
sensible (an existing "Cooking" group plus new chicken-care tabs becomes
"Chicken"), or the current split is clearly wrong. A broader, more accurate
category is worth moving older tabs for; cosmetic churn is not.`:"";return`You are "Tidy", an engine that organizes a browser sidebar's open tabs
into a small set of clean, intuitive groups — like Arc's "Tidy Tabs".

## Input
${t} tabs. Each object has {"i": <index 0-${n}>, "title": <string>}
and may also include "url": <string> and "group": <string> (the name of
the group the tab is CURRENTLY in). Treat "group" as a strong hint, not a
command. Use whatever fields are present; the title is always the primary signal.

The ${t} tabs are provided in the user message as a JSON array,
one object per tab.

## What a good grouping looks like
- Group by what the user is DOING — a project, topic, game, or task —
not merely by website. Tabs from different domains often belong
together (a wiki page, a YouTube video, and a store page about the
same game are one group).
- Name an EXPANDABLE CATEGORY, not the single tab in front of you. A
group should be something later tabs could naturally join: "Wynncraft"
over "Gaming", "Chicken Recipes" over "Grandma's Chicken Soup". Don't
make a group as specific as possible — as specific as is still reusable.
- Prefer multi-tab groups. A single-tab group is fine ONLY when its name
is a real category a later tab could join, never when it just
re-describes that one tab.
- Keep granularity consistent: groups of roughly comparable size.
Avoid one giant catch-all sitting next to several singletons.
- Merge near-duplicates (the same product, repeated searches) together.${s}

## Grounding (critical)
- Use ONLY the titles and URLs given. Never invent a theme that the
tabs do not clearly support. If no tab is about sports, there is no
"Sports" group. Every group must be justified by its members.

## Avoid
- A vague mega-group holding most tabs.
- Many one-tab groups when those tabs share an obvious theme.
- A one-tab group whose name just describes that tab (a recipe group
named after one dish) instead of an expandable category.
- Two different groups that mean the same thing.

## Naming
- 1-3 words, Title Case, human-readable. No emojis, no quotes.
- Name the shared theme, not a list of the items.
- "Other" is a LAST RESORT — only for a tab that fits no reasonable
category, or a pile of mutually unrelated tabs. Never reach for it when
a genuine expandable category fits. Avoid "Misc", "Various", "General",
"Web", and "Stuff" entirely; use "Other" if you truly must.

## Hard constraints (must all hold)
1. Produce between 1 and ${r} groups (1 is fine if every tab shares one theme).
2. Every index 0-${n} appears in EXACTLY ONE group.
 Never skip an index, never repeat one, never invent one out of range.
3. Output ONLY a single JSON object matching the schema — no prose,
 no markdown, no code fences.

## Output schema
{"groups":[{"name":"<Title Case label>","tabs":[<indices>]}]}

## Examples
Input: [{"i":0,"title":"Horses - Wynncraft Wiki","url":"wiki.wynncraft.com/horses"},{"i":1,"title":"Wynncraft Market","url":"trade.wynncraft.com"},{"i":2,"title":"Best Beef Chili Recipe","url":"allrecipes.com/chili"},{"i":3,"title":"Van Gogh Mouse Pad - AliExpress","url":"aliexpress.com/x"},{"i":4,"title":"Monet Mouse Pad - AliExpress","url":"aliexpress.com/y"}]
Output: {"groups":[{"name":"Wynncraft","tabs":[0,1]},{"name":"Mouse Pad Shopping","tabs":[3,4]},{"name":"Recipes","tabs":[2]}]}

Input (all one theme): [{"i":0,"title":"React useEffect docs","url":"react.dev"},{"i":1,"title":"React Router tutorial","url":"reactrouter.com"},{"i":2,"title":"Why my React app re-renders","url":"stackoverflow.com"}]
Output: {"groups":[{"name":"React","tabs":[0,1,2]}]}

Input (one solid theme + unrelated odds and ends): [{"i":0,"title":"Rust ownership - The Rust Book"},{"i":1,"title":"Tokio async tutorial"},{"i":2,"title":"Why won't my future compile - stackoverflow"},{"i":3,"title":"DMV appointment booking"},{"i":4,"title":"Local weather - today"}]
Output: {"groups":[{"name":"Rust","tabs":[0,1,2]},{"name":"Other","tabs":[3,4]}]}

Now output only the JSON object.`},buildUserContent(e){return`<tabs>
${JSON.stringify(e)}
</tabs>`},responseSchema(){return{type:"object",additionalProperties:!1,required:["groups"],properties:{groups:{type:"array",items:{type:"object",additionalProperties:!1,required:["name","tabs"],properties:{name:{type:"string"},tabs:{type:"array",items:{type:"integer"}}}}}}}},async request(e,t,n){let r=Math.min(o.api.maxTokensCeiling,Math.max(o.api.maxTokens,e.length*o.api.tokensPerTab+o.api.tokensBuffer)),a={model:n,temperature:o.api.temperature,seed:o.api.seed,max_tokens:r,messages:[{role:"system",content:A.buildPrompt(e)},{role:"user",content:A.buildUserContent(e)}]},s=[{type:"json_schema",json_schema:{name:"tidy_groups",strict:!0,schema:A.responseSchema()}},{type:"json_object"},null],u;for(let d=0;d<s.length;d++){let c=s[d]?{...a,response_format:s[d]}:{...a};try{return await A.post(c,t)}catch(g){let T=g;if(T?.status===400&&/response_format|json[_ ]?schema|json/i.test(T.message??"")&&d<s.length-1){let w=s[d],h=s[d+1];i.ai.warn(`Model "${n}" rejected response_format=${w?.type} (HTTP 400); retrying with ${h?h.type:"no response_format"}.`),u=g;continue}throw g}}throw u},async post(e,t){i.ai.debug(`Requesting completion from OpenRouter (model: ${e.model}, max_tokens: ${e.max_tokens}, timeout: ${o.api.timeoutMs}ms).`);let n=new AbortController,r=setTimeout(()=>n.abort(),o.api.timeoutMs),a;try{a=await fetch(o.api.endpoint,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${t}`,"HTTP-Referer":o.api.referer,"X-Title":o.api.title},body:JSON.stringify(e),signal:n.signal})}catch(s){throw s?.name==="AbortError"?(i.ai.error(`OpenRouter request aborted after exceeding the ${o.api.timeoutMs/1e3}s timeout (model: ${e.model}).`),new Error(`OpenRouter request timed out after ${o.api.timeoutMs/1e3}s`)):(i.ai.error(`Network error while contacting OpenRouter (endpoint: ${o.api.endpoint}).`,s),s)}finally{clearTimeout(r)}if(i.ai.debug(`OpenRouter responded with HTTP ${a.status}${a.statusText?` ${a.statusText}`:""}.`),!a.ok){let s=(await a.text()).slice(0,o.api.errorBodyMaxChars);i.ai.error(`OpenRouter request failed with HTTP ${a.status}. Response body (truncated): ${s}`);let u=new Error(`OpenRouter ${a.status}: ${s}`);throw u.status=a.status,u}return a.json()},extractText(e){if(e.error){let a=e.error.message||JSON.stringify(e.error);throw i.ai.error("OpenRouter returned an error payload:",a),new Error(`API error: ${a}`)}if(e.choices?.[0]?.finish_reason==="length")throw i.ai.error("Model response was truncated (finish_reason: length).","model:",e.model,"| usage:",JSON.stringify(e.usage)),new Error("Model response was truncated before completing the JSON (hit the output token limit). Try tidying fewer tabs or use a model with a larger output budget.");let t=e.choices?.[0]?.message,r=(Array.isArray(t?.content)?t.content.map(a=>a?.text??a?.content??"").join(""):t?.content??"").trim();if(!r&&t?.reasoning&&i.ai.debug("Model returned reasoning but no completion; treating as empty.",String(t.reasoning).slice(0,o.api.outputPreviewMaxChars)),!r)throw i.ai.error("Model returned an empty completion.","finish_reason:",e.choices?.[0]?.finish_reason,"| model:",e.model,"| usage:",JSON.stringify(e.usage)),new Error("Model returned empty content. Try a concrete instruct model (e.g. openai/gpt-4o-mini) instead of a free/reasoning router.");return r.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"").trim()},parseGroups(e,t){let n=()=>e.slice(0,o.api.outputPreviewMaxChars),r;try{r=JSON.parse(e)}catch{i.ai.debug("Completion was not strict JSON; extracting the first {…} block.");let h=e.match(/\{[\s\S]*\}/);if(!h)throw i.ai.error("Could not extract any JSON object from the model output (truncated):",n()),new Error(`Could not parse model output: ${n()}`);r=JSON.parse(h[0])}let a=Array.isArray(r?.groups)?r.groups:[],s=new Set,u=a.reduce((h,E)=>{let _=(Array.isArray(E?.tabs)?E.tabs:[]).map(b=>typeof b=="string"?Number(b):b).filter(b=>typeof b=="number"&&Number.isInteger(b)&&b>=0&&b<t.length&&!s.has(b)).map(b=>(s.add(b),t[b]));return _.length>0&&h.push({name:String(E?.name??"").trim()||"Group",tabs:_}),h},[]),d=u.filter(h=>h.tabs.length>=2).length,c=0,{kept:g,overflow:T}=u.reduce((h,E)=>(E.tabs.length>=2?h.kept.push(E):c<d?(h.kept.push(E),c++):h.overflow.push(...E.tabs),h),{kept:[],overflow:[]});T.length>0&&i.ai.debug(`Single-tab budget exceeded; folding ${T.length} surplus singleton tab(s) into "Other".`);let x=t.filter((h,E)=>!s.has(E));x.length>0&&i.ai.debug(`Model left ${x.length} tab(s) ungrouped; collecting them into "Other".`);let w=[...T,...x];return w.length>0&&g.push({name:"Other",tabs:w}),i.ai.debug(`Parsed model output into ${g.length} group(s) covering ${s.size+x.length} tab(s).`),g}};var y={el(e,t,n){let r=l.createElement(e);return t&&(r.className=t),n!=null&&(r.textContent=n),r},field(e,t){let n=y.el("div","zen-tidy-tabs-field");return n.append(y.el("label","zen-tidy-tabs-label",e),t),n},input(e,{type:t="text",placeholder:n=""}={}){let r=y.el("input","zen-tidy-tabs-input");return r.type=t,r.value=e??"",n&&(r.placeholder=n),r},button(e,t=""){return y.el("button",`zen-tidy-tabs-btn${t?` ${t}`:""}`,e)}};var C={keyHandler:null,open(e){C.close();let t=y.el("div","zen-tidy-tabs-overlay");t.id=o.ui.overlayId;let n=y.el("div","zen-tidy-tabs-modal");n.setAttribute("role","dialog"),n.setAttribute("aria-modal","true"),n.setAttribute("aria-label",e);let r=y.el("div","zen-tidy-tabs-modal-header");r.append(y.el("div","zen-tidy-tabs-modal-title",e));let a=y.el("button","zen-tidy-tabs-modal-close","✕");a.setAttribute("aria-label","Close"),a.addEventListener("click",C.close),r.append(a);let s=y.el("div","zen-tidy-tabs-modal-body"),u=y.el("div","zen-tidy-tabs-modal-footer");return n.append(r,s,u),t.append(n),t.addEventListener("mousedown",d=>{d.target===t&&C.close()}),C.keyHandler=d=>{d.key==="Escape"?C.close():d.key==="Tab"&&C.trapFocus(d,n)},l.addEventListener("keydown",C.keyHandler,!0),(l.documentElement||l.body).appendChild(t),requestAnimationFrame(()=>t.classList.add("open")),{overlay:t,body:s,footer:u}},trapFocus(e,t){let n=[...t.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter(u=>{let d=u;return!d.disabled&&d.offsetParent!==null});if(n.length===0)return;let r=n[0],a=n[n.length-1],s=l.activeElement;e.shiftKey&&(s===r||!t.contains(s))?(e.preventDefault(),a.focus()):!e.shiftKey&&s===a&&(e.preventDefault(),r.focus())},close(){C.keyHandler&&(l.removeEventListener("keydown",C.keyHandler,!0),C.keyHandler=null),l.getElementById(o.ui.overlayId)?.remove()}};var N={theme:{bg:"var(--zen-main-browser-background, #1f1e25)",elevated:"var(--zen-colors-tertiary, #2a2833)",border:"var(--zen-colors-border, #3a3845)",text:"var(--zen-primary-color, #ECECEC)",muted:"#9b99a6",accent:"var(--zen-primary-color, #6c5ce7)"},labelStyleCss(){return v.labelStyle()!=="text"?"":`
      .tab-group-label {
        background: transparent !important;
        color: var(--toolbox-textcolor, var(--toolbar-color, currentColor)) !important;
        opacity: .9;
        font-weight: 700 !important;
        letter-spacing: .01em;
        text-shadow: none !important;
      }
      .tab-group-label:hover { opacity: 1; }
    `},inject(){let e=N.theme;l.getElementById(o.ui.styleId)?.remove();let t=l.createElement("style");t.id=o.ui.styleId,t.textContent=`
      #${o.ui.controlId} {
        cursor: pointer;
        color: inherit !important;
        font: inherit !important;
        background: none !important;
        border: none !important;
        box-shadow: none !important;
      }
      #${o.ui.controlId}::before { content: none !important; }
      #${o.ui.controlId}.zen-tidy-tabs-fallback {
        display: block !important;
        visibility: visible !important;
        box-sizing: border-box;
        width: calc(100% - 12px);
        margin: 2px 6px;
        padding: 2px 6px;
        text-align: right;
        font-size: 12px;
        color: ${e.accent} !important;
        opacity: 0;
        transition: opacity .12s ease;
      }
      .zen-workspace-tabs-section:hover #${o.ui.controlId}.zen-tidy-tabs-fallback { opacity: .85; }
      #${o.ui.controlId}.zen-tidy-tabs-fallback:hover { opacity: 1; }

      .zen-tidy-tabs-overlay {
        position: fixed; inset: 0; z-index: 2147483647;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0,0,0,.45);
        -moz-window-dragging: no-drag;
        opacity: 0; transition: opacity .14s ease;
      }
      .zen-tidy-tabs-overlay.open { opacity: 1; }
      .zen-tidy-tabs-modal {
        width: 340px; max-width: calc(100vw - 32px);
        background: ${e.bg};
        color: ${e.text};
        border: 1px solid ${e.border};
        border-radius: 14px;
        box-shadow: 0 18px 48px rgba(0,0,0,.5);
        font: menu;
        overflow: hidden;
        transform: translateY(6px) scale(.985);
        transition: transform .14s ease;
      }
      .zen-tidy-tabs-overlay.open .zen-tidy-tabs-modal { transform: none; }
      .zen-tidy-tabs-modal-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 16px 10px;
      }
      .zen-tidy-tabs-modal-title { font-size: 14px; font-weight: 600; }
      .zen-tidy-tabs-modal-close {
        all: unset; cursor: pointer; color: ${e.muted};
        width: 22px; height: 22px; border-radius: 6px; text-align: center;
      }
      .zen-tidy-tabs-modal-close:hover { background: ${e.elevated}; color: ${e.text}; }
      .zen-tidy-tabs-modal-body { padding: 4px 16px 8px; display: flex; flex-direction: column; gap: 14px; }
      .zen-tidy-tabs-modal-footer {
        display: flex; align-items: center; gap: 8px;
        padding: 12px 16px 16px;
      }
      .zen-tidy-tabs-spacer { flex: 1; }

      .zen-tidy-tabs-field { display: flex; flex-direction: column; gap: 6px; }
      .zen-tidy-tabs-label { font-size: 11px; color: ${e.muted}; font-weight: 600; }
      .zen-tidy-tabs-input {
        all: unset; box-sizing: border-box; width: 100%;
        padding: 8px 10px; font-size: 13px;
        color: ${e.text};
        background: ${e.elevated};
        border: 1px solid ${e.border}; border-radius: 9px;
      }
      .zen-tidy-tabs-input:focus {
        border-color: ${e.accent};
      }

      .zen-tidy-tabs-segment {
        display: inline-flex; flex-wrap: wrap; padding: 3px; gap: 3px;
        background: ${e.elevated}; border: 1px solid ${e.border};
        border-radius: 10px;
      }
      .zen-tidy-tabs-seg {
        all: unset; cursor: pointer; padding: 5px 12px; font-size: 12px;
        color: ${e.muted}; border-radius: 7px; text-align: center;
      }
      .zen-tidy-tabs-seg.active { background: ${e.accent}; color: #fff; }

      .zen-tidy-tabs-hint { margin: 2px 0 0; font-size: 11px; color: ${e.muted}; }
      .zen-tidy-tabs-privacy-note { margin: 2px 0 0; font-size: 13px; line-height: 1.45; color: ${e.text}; }
      .zen-tidy-tabs-link { color: ${e.accent}; cursor: pointer; text-decoration: underline; }

      .zen-tidy-tabs-btn {
        all: unset; cursor: pointer; padding: 7px 14px; font-size: 13px; font-weight: 600;
        border-radius: 9px; color: ${e.text}; background: ${e.elevated};
        border: 1px solid ${e.border}; text-align: center;
      }
      .zen-tidy-tabs-btn:hover { filter: brightness(1.12); }
      .zen-tidy-tabs-btn.primary { background: ${e.accent}; border-color: transparent; color: #fff; }
      .zen-tidy-tabs-btn.ghost { background: transparent; }

      .zen-tidy-tabs-inline-input {
        all: unset;
        box-sizing: border-box;
        min-width: 0; max-width: 100%;
        font: inherit;
        cursor: text;
        caret-color: ${e.accent};
      }

      /* BADGE-7: while renaming, stop Zen's empty sidebar from swallowing the mouse press */
      :root.zen-tidy-tabs-editing .zen-workspace-empty-space {
        -moz-window-dragging: no-drag;
      }

      ${N.labelStyleCss()}
    `,(l.head||l.documentElement).appendChild(t),i.styles.debug(`Stylesheet injected (#${o.ui.styleId}, labelStyle: ${v.labelStyle()}).`)}};var R={segmentedControl(e,t,n){let r=t,a=y.el("div","zen-tidy-tabs-segment");return e.forEach(([s,u])=>{let d=y.el("button","zen-tidy-tabs-seg",u);s===t&&d.classList.add("active"),d.addEventListener("click",()=>{r=s,a.querySelectorAll(".zen-tidy-tabs-seg").forEach(c=>{c.classList.remove("active")}),d.classList.add("active"),n?.(s)}),a.append(d)}),{el:a,get:()=>r}},settings(){let{body:e,footer:t}=C.open("Zen Tidy Tabs Settings");i.user.debug("Opened the settings modal.");let n=y.input(v.apiKey(),{type:"password",placeholder:"sk-or-v1-..."}),r=y.input(v.model(),{placeholder:o.api.defaultModel}),a=R.segmentedControl([["filled","Colored"],["text","Text only"]],v.labelStyle()),s={detailed:"The tab's title and full URL are sent to the AI.",compact:"The tab's title and hostname are sent to the AI.",minimal:"Only the tab's title is sent to the AI."},u=y.el("p","zen-tidy-tabs-privacy-note",s[v.urlMode()]??s.detailed),d=R.segmentedControl([["detailed","Detailed"],["compact","Compact"],["minimal","Minimal"]],v.urlMode(),E=>{u.textContent=s[E]??s.detailed??""}),c=y.el("p","zen-tidy-tabs-hint");c.append(l.createTextNode("Key is stored locally. Get one at "));let g="https://openrouter.ai/keys",T=y.el("a","zen-tidy-tabs-link","openrouter.ai/keys");T.setAttribute("href",g);let x=E=>{E?.preventDefault(),C.close(),typeof m.openTrustedLinkIn=="function"?m.openTrustedLinkIn(g,"tab"):typeof p.addTrustedTab=="function"?p.selectedTab=p.addTrustedTab(g):i.user.error(`Could not open ${g}: no trusted-link API is available in this build.`)};T.addEventListener("click",x),T.addEventListener("keydown",E=>{E.key===" "&&x(E)}),c.append(T,l.createTextNode(".")),e.append(y.field("OpenRouter API key",n),y.field("Model",r),y.field("Group labels",a.el),y.field("Tab info sent to AI",d.el),u,c);let w=y.button("Cancel","ghost");w.addEventListener("click",C.close);let h=y.button("Save settings","primary");h.addEventListener("click",()=>{v.set(o.prefs.apiKey,n.value.trim()),v.set(o.prefs.model,r.value.trim()),v.set(o.prefs.labelStyle,a.get()),v.set(o.prefs.urlMode,d.get()),i.user.info(`Settings saved (model: ${r.value.trim()||o.api.defaultModel}, labelStyle: ${a.get()}, urlMode: ${d.get()}, apiKey: ${n.value.trim()?"set":"empty"}).`),N.inject(),C.close(),z.notify("Settings saved.")}),t.append(y.el("div","zen-tidy-tabs-spacer"),w,h),n.focus()}};var $={build(e){let t=l.createElement(e?e.tagName:"span");t.id=o.ui.controlId,t.textContent=o.ui.label,t.setAttribute("label",o.ui.label),t.setAttribute("tooltiptext",o.ui.tooltip),t.title=o.ui.tooltip,t.className=e?e.className:"zen-tidy-tabs-fallback",e&&(t.classList.remove(o.ui.clearButtonClass),t.dataset.twin="1");let n=r=>{r.preventDefault(),r.stopPropagation(),i.user.debug("Tidy control activated (click / command)."),z.runTidy()};return t.addEventListener("click",n),t.addEventListener("command",n),t.addEventListener("contextmenu",r=>{r.preventDefault(),r.stopPropagation(),i.user.debug("Tidy control right-clicked; opening settings."),R.settings()}),t},twinIsCurrent(){let e=l.getElementById(o.ui.controlId);if(!(e?.dataset?.twin==="1"&&e.isConnected))return!1;let t=f.clearControl();return!!t&&e.parentElement===t.parentElement&&e.nextElementSibling===t},placeTwinIfClearPresent(){if($.twinIsCurrent())return!0;let e=f.clearControl();return e?.parentElement?(l.getElementById(o.ui.controlId)?.remove(),e.parentElement.insertBefore($.build(e),e),i.dom.info(`Tidy control mounted as a twin of the Clear button (${f.describe(e)}).`),!0):!1},installClearWatcher(){let e=m.__zenTidyTabsClearWatcher;if(e?.token===B)return;e&&e.target.removeEventListener("mouseover",e.handler,!0);let t=l.documentElement,n=()=>{let r=l.getElementById(o.ui.controlId);r?.dataset?.twin==="1"&&r.isConnected&&r.nextElementSibling&&H(r.nextElementSibling)&&f.activeWorkspaceEl()?.contains(r)||$.placeTwinIfClearPresent()};t.addEventListener("mouseover",n,!0),m.__zenTidyTabsClearWatcher={token:B,target:t,handler:n},i.dom.debug("Clear-button hover watcher installed on",`${f.describe(t)}.`)},installWorkspaceWatcher(){let e=m.__zenTidyTabsWorkspaceWatcher;if(e?.token===B)return;let t=m.gZenWorkspaces;if(typeof t?.addChangeListeners!="function")return;e&&t.removeChangeListeners?.(e.listener);let n=()=>$.mount();t.addChangeListeners(n,{once:!1}),m.__zenTidyTabsWorkspaceWatcher={token:B,listener:n},i.dom.debug("Workspace-change watcher installed; Tidy control will follow the active workspace.")},mount(){if($.installClearWatcher(),$.installWorkspaceWatcher(),$.placeTwinIfClearPresent())return!0;let e=l.getElementById(o.ui.controlId),t=f.activeSection();if(e&&t&&!t.contains(e)&&e.remove(),!l.getElementById(o.ui.controlId)){let n=t&&f.firstNormalNode(t);if(n?.parentElement)return n.parentElement.insertBefore($.build(null),n),i.dom.info("Tidy control mounted via separator fallback (hover to reveal; will upgrade to a Clear twin when one appears)."),!0}return i.dom.debug("No mount target available yet; will retry or wait for a hover."),!!l.getElementById(o.ui.controlId)},setBusy(e){let t=l.getElementById(o.ui.controlId);t&&(t.textContent=e?o.ui.busyLabel:o.ui.label,t.setAttribute("label",e?o.ui.busyLabel:o.ui.label),t.style.pointerEvents=e?"none":"")}};var z={running:!1,notify(e,t=!1){(t?i.tidy.error:i.tidy.info)(e);try{let n=p.getNotificationBox(),r=n.appendNotification(o.ui.notificationValue,{label:`Zen Tidy Tabs: ${e}`,priority:t?n.PRIORITY_WARNING_HIGH:n.PRIORITY_INFO_LOW},[]);Promise.resolve(r).then(a=>{a&&setTimeout(()=>{try{n.removeNotification(a)}catch{}},o.timing.notifyDurationMs)})}catch{}},async runTidy(){if(z.running){i.tidy.debug("Ignoring Tidy request: a tidy run is already in progress.");return}let e=v.apiKey();if(!e){i.tidy.warn("Tidy aborted: no OpenRouter API key configured."),z.notify(`Set your key in about:config → ${o.prefs.apiKey}`,!0);return}let t=L.collect(!0);if(t.length<o.grouping.minTabs){i.tidy.warn(`Tidy aborted: only ${t.length} eligible tab(s), need at least ${o.grouping.minTabs}.`),z.notify(`Need at least ${o.grouping.minTabs} tabs to tidy.`,!0);return}z.running=!0,$.setBusy(!0);try{i.tidy.info(`Starting tidy of ${t.length} tab(s) (model: ${v.model()}, urlMode: ${v.urlMode()}).`);let n=await A.request(L.snapshot(t),e,v.model()),r=A.parseGroups(A.extractText(n),t);i.tidy.info("Grouping plan:",r.map(u=>`${u.name}(${u.tabs.length})`).join(", "));let{realized:a,failed:s}=k.apply(r);k.scheduleEmptyCheck(),s===0?(i.tidy.info(`Tidy complete: sorted ${t.length} tab(s) into ${a} group(s).`),z.notify(`Sorted ${t.length} tabs into ${a} groups.`)):a>0?(i.tidy.warn(`Tidy partially complete: created ${a} group(s), ${s} could not be created.`),z.notify(`Sorted ${t.length} tabs into ${a} groups; ${s} could not be created.`,!0)):(i.tidy.error(`Tidy failed: none of the ${r.length} group(s) could be created.`),z.notify("Tidy failed: no groups could be created.",!0))}catch(n){i.tidy.error("Tidy run failed.",n),z.notify(`Tidy failed: ${n.message||n}`,!0)}finally{z.running=!1,$.setBusy(!1)}}};var O={customize(){o.panel.hideSaveAndClose&&O.hideSaveAndClose(),o.panel.overrideUngroup&&O.installUngroupOverride()},hideSaveAndClose(){let e=l.getElementById(o.panel.ids.saveAndClose);e&&(e.hidden=!0)},installUngroupOverride(){if(m.__zenTidyTabsPanelOverride)return;let e=p.tabGroupMenu?.panel;if(!e)return;let t=n=>{n.target?.id===o.panel.ids.ungroup&&(n.preventDefault(),n.stopPropagation(),O.ungroup(p.tabGroupMenu?.activeGroup))};e.addEventListener("command",t,!0),m.__zenTidyTabsPanelOverride={panel:e,onCommand:t},i.user.debug("Installed 'Ungroup tabs' override on the native panel.")},uninstall(){let e=m.__zenTidyTabsPanelOverride;if(e){try{e.panel.removeEventListener("command",e.onCommand,!0)}catch{}m.__zenTidyTabsPanelOverride=null}},ungroup(e){if(!e)return;let t=G(e),n=k.detachAndDissolve(e,`ungrouping "${t}"`);try{p.tabGroupMenu?.close?.()}catch{}i.user.info(`Ungrouped ${n} tab(s) from "${t}".`)}};var K="http://www.w3.org/1999/xhtml",S={active:null,install(){let e=m.__zenTidyTabsEditorListeners;e&&(l.removeEventListener("click",e.onClick,!0),l.removeEventListener("contextmenu",e.onContextMenu,!0)),S.cancelInline(),l.querySelectorAll(".zen-tidy-tabs-inline-input").forEach(r=>{let a=r.previousElementSibling;a?.tagName?.toLowerCase()==="span"&&a.remove(),r.remove()}),l.querySelectorAll(".zen-tidy-tabs-inline-editing").forEach(r=>{r.style.removeProperty("display"),r.classList.remove("zen-tidy-tabs-inline-editing")}),l.documentElement.classList.remove("zen-tidy-tabs-editing"),O.uninstall();let t=r=>{if(r.button!==0)return;if(r.target?.closest?.(".zen-tidy-tabs-inline-input")){r.stopPropagation();return}let a=r.target?.closest?.(".tab-group-label");if(!a)return;let s=a.closest("tab-group");s&&(r.preventDefault(),r.stopPropagation(),S.startInline(s,a))},n=r=>{let a=r.target?.closest?.(".tab-group-label, .zen-tidy-tabs-inline-input");if(!a)return;let s=a.closest("tab-group");s&&(r.preventDefault(),r.stopPropagation(),S.cancelInline(),setTimeout(()=>{try{p.tabGroupMenu?.openEditModal(s),O.customize()}catch(u){i.user.error("Failed to open Zen's native group edit panel.",u)}},0))};l.addEventListener("click",t,!0),l.addEventListener("contextmenu",n,!0),m.__zenTidyTabsEditorListeners={onClick:t,onContextMenu:n},i.user.debug("Group label editor installed.")},startInline(e,t){if(S.active?.labelEl===t){S.active.input.focus();return}S.cancelInline();let n=G(e),r=l.createElementNS(K,"input");r.className="zen-tidy-tabs-inline-input",r.value=n,r.setAttribute("aria-label","Rename group");let a=getComputedStyle(t);["fontFamily","fontSize","fontWeight","fontStyle","letterSpacing","lineHeight","color","backgroundColor","backgroundImage","paddingTop","paddingRight","paddingBottom","paddingLeft","borderRadius","height","textAlign","textShadow"].forEach(b=>{r.style[b]=a[b]??""});let u=l.createElementNS(K,"span");u.style.position="absolute",u.style.visibility="hidden",u.style.whiteSpace="pre",u.style.pointerEvents="none",["fontFamily","fontSize","fontWeight","fontStyle","letterSpacing"].forEach(b=>{u.style[b]=a[b]??""});let c=2,g=8,T=()=>{u.textContent=r.value??"";let b=Math.ceil(u.getBoundingClientRect().width)+c;r.style.width=`${Math.max(b,g)}px`};r.style.boxSizing="content-box",r.style.flex="0 0 auto",t.classList.add("zen-tidy-tabs-inline-editing"),l.documentElement.classList.add("zen-tidy-tabs-editing"),t.style.display="none",t.parentNode?.insertBefore(r,t),r.parentNode?.insertBefore(u,r),T();let x=!1,w=b=>{if(x)return;x=!0;let P=r.value.trim();if(S.finishInline(),b&&P&&P!==n)try{D(e,P),i.user.info(`Renamed group "${n}" to "${P}".`)}catch(J){i.user.error(`Failed to rename group "${n}" to "${P}".`,J)}},h=b=>{b.key==="Enter"?(b.preventDefault(),w(!0)):b.key==="Escape"&&(b.preventDefault(),w(!1)),b.stopPropagation()},E=()=>w(!0),_=b=>{b.target===r||r.contains(b.target)||w(!0)};r.addEventListener("input",T),r.addEventListener("keydown",h,!0),r.addEventListener("blur",E),l.addEventListener("mousedown",_,!0),S.active={input:r,labelEl:t,group:e,original:n,discard:()=>w(!1),cleanup:()=>{u.remove(),r.removeEventListener("input",T),r.removeEventListener("keydown",h,!0),r.removeEventListener("blur",E),l.removeEventListener("mousedown",_,!0)}},r.focus(),r.select()},finishInline(){let e=S.active;e&&(S.active=null,e.cleanup?.(),e.input.remove(),l.documentElement.classList.remove("zen-tidy-tabs-editing"),e.labelEl.style.removeProperty("display"),e.labelEl.classList.remove("zen-tidy-tabs-inline-editing"))},cancelInline(){S.active?.discard?.()}};var V=()=>{if(i.init.info("Loading Zen Tidy Tabs…"),i.init.debug("location:",(()=>{try{return location.href}catch{return"?"}})()),i.init.debug(`Environment: gBrowser.addTabGroup is ${typeof p.addTabGroup}, ${p.tabs.length} tab(s) open.`),N.inject(),S.install(),k.installEmptyWatcher(),o.debug&&M.run(),m.__zenTidyTabsMountRetryTimer&&(clearInterval(m.__zenTidyTabsMountRetryTimer),m.__zenTidyTabsMountRetryTimer=null),!$.mount()){let e=0;m.__zenTidyTabsMountRetryTimer=setInterval(()=>{($.mount()||++e>o.timing.mountMaxAttempts)&&(clearInterval(m.__zenTidyTabsMountRetryTimer),m.__zenTidyTabsMountRetryTimer=null,l.getElementById(o.ui.controlId)||i.dom.warn(`Tidy control not placed after ${e} attempt(s); it will appear when you hover the tab separator.`))},o.timing.mountRetryMs)}m.zenTidyTabs={run:()=>z.runTidy(),settings:()=>R.settings(),mount:()=>$.mount(),diagnose:()=>M.run(),injectStyles:()=>N.inject(),collect:(e=!0)=>L.collect(e)},i.init.info("Ready — left-click the Tidy control to organize tabs; right-click it for settings.")};V();})();
