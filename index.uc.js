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
(()=>{var n={debug:!1,prefs:{apiKey:"zen-tidy-tabs.apikey",model:"zen-tidy-tabs.model",labelStyle:"zen-tidy-tabs.labelstyle",urlMode:"zen-tidy-tabs.urlmode"},api:{endpoint:"https://openrouter.ai/api/v1/chat/completions",defaultModel:"openai/gpt-4o-mini",maxTokens:2048,maxTokensCeiling:8192,tokensPerTab:24,tokensBuffer:256,temperature:0,seed:7,timeoutMs:9e4,errorBodyMaxChars:300,outputPreviewMaxChars:200,referer:"https://github.com/PCOffline/zen-tidy-tabs",title:"Zen Tidy Tabs"},ui:{controlId:"zen-tidy-tabs-button",styleId:"zen-tidy-tabs-style",overlayId:"zen-tidy-tabs-overlay",notificationValue:"zen-tidy-tabs-msg",label:"🧹 Tidy",busyLabel:"↻ Tidying…",tooltip:"Tidy tabs with AI",clearButtonClass:"zen-workspace-close-unpinned-tabs-button"},panel:{hideSaveAndClose:!0,overrideUngroup:!0,ids:{saveAndClose:"tabGroupEditor_saveAndCloseGroup",ungroup:"tabGroupEditor_ungroupTabs"}},grouping:{colors:["blue","red","yellow","green","pink","purple","cyan","orange","gray"],minTabs:3,minGroups:2,maxGroups:8,targetTabsPerGroup:3},snapshot:{titleMax:160,urlMax:120},timing:{emptyCheckDelayMs:80,emptyCheckIntervalMs:150,emptyCheckMaxTries:6,emptyWatcherDebounceMs:500,notifyDurationMs:6e3,mountRetryMs:250,mountMaxAttempts:40}};var Z="[Zen Tidy Tabs]",N=e=>{let t=`${Z} [${e}]`;return{info:(...o)=>console.info(t,...o),warn:(...o)=>console.warn(t,...o),error:(...o)=>console.error(t,...o),debug:(...o)=>{n.debug&&console.debug(t,...o)}}},i={init:N("Initialization"),config:N("Config"),dom:N("DOM"),styles:N("Styles"),ai:N("AI"),groups:N("Groups"),tidy:N("Tidy"),user:N("User Interaction"),diagnose:N("Diagnostics")};var U=(()=>{let e=typeof window>"u"?null:window;if(!e?.gBrowser)try{let t=Services.wm.getMostRecentWindow("navigator:browser");t?.gBrowser&&(e=t)}catch(t){i.init.error("Could not resolve a browser window via Services.wm; gBrowser is unavailable.",t)}return e?.gBrowser?{win:e,doc:e.document,gBrowser:e.gBrowser}:null})();if(!U){let e="No window with gBrowser found. Use the Browser Console (Ctrl+Shift+J) with devtools.chrome.enabled = true.";throw i.init.error(`Startup aborted: ${e}`),new Error(e)}var{win:y,doc:l,gBrowser:p}=U,B={};var X="tab, .tabbrowser-tab",W=e=>String(e??"").trim().toLowerCase(),L=e=>(e?.label||e?.getAttribute?.("label")||"").trim(),H=e=>e?.color??e?.getAttribute?.("color")??"",F=e=>e.tabs||e.querySelectorAll(X),j=(e,t)=>{e.label=t,e.setAttribute("label",t)},K=(e,t)=>{e.color=t,e.setAttribute("color",t)},q="toolbarbutton, button, label, span, hbox, vbox, toolbaritem, div, image, [label], [tooltiptext]",D=e=>!!((e.getAttribute?.("label")??"").trim().toLowerCase()==="clear"||(e.textContent??"").trim().toLowerCase()==="clear"||e.children.length===0&&["::before","::after"].some(o=>{try{return/clear/i.test(getComputedStyle(e,o).content??"")}catch{return!1}})),f={activeWorkspaceEl(){return y.gZenWorkspaces?.activeWorkspaceElement||l.querySelector("zen-workspace[active]")||p.selectedTab?.closest?.("zen-workspace")||l.querySelector("zen-workspace")},activeSection(){return p.selectedTab?.closest?.(".zen-workspace-tabs-section")||l.querySelector(".zen-workspace-tabs-section[active]")||l.querySelector(".zen-workspace-tabs-section")},clearControl(){let e=[f.activeWorkspaceEl(),f.activeSection(),l].filter(Boolean),t=new Set;for(let o of e)for(let r of o.querySelectorAll(q))if(!t.has(r)&&(t.add(r),D(r)))return r;return null},firstNormalNode(e){return Array.from(e.querySelectorAll("tab-group, tab, .tabbrowser-tab")).find(t=>f.isGroupEl(t)||!(t.pinned||t.hasAttribute?.("zen-essential")))??null},isGroupEl(e){return(e?.tagName??"").toLowerCase()==="tab-group"||e?.classList?.contains?.("tab-group")},describe(e){return e?(e.tagName??"?").toLowerCase()+(e.id?`#${e.id}`:"")+(e.className?`.${String(e.className).trim().split(/\s+/)[0]}`:""):"null"}};var A={pseudo(e,t){try{return getComputedStyle(e,t).content??""}catch{return""}},path(e,t=8){let o=[],r=e;for(let a=0;r&&a<t;a++)o.unshift(f.describe(r)),r=r.parentElement;return o.join(" > ")},clearCandidates(){return[...l.querySelectorAll(q)].filter(D).map(e=>({el:e,text:(e.textContent??"").trim(),label:e.getAttribute?.("label")??"",tip:e.getAttribute?.("tooltiptext")??"",pseudo:e.children.length>0?"":A.pseudo(e,"::before")+A.pseudo(e,"::after")}))},newTabButton(){return(l.getElementById("tabs-newtab-button")||l.querySelector("[command='cmd_newNavigatorTab'], .tabs-newtab-button, #vertical-tabs-newtab-button")||[...l.querySelectorAll("toolbarbutton, button")].find(e=>/new tab/i.test(`${e.getAttribute("label")??""} ${e.textContent??""}`)))??null},run(){i.diagnose.info("DOM diagnosis start");let r=p.selectedTab;i.diagnose.info("selectedTab:",f.describe(r)),i.diagnose.info("  ancestry:",A.path(r));let a=f.activeSection();i.diagnose.info("activeSection:",f.describe(a)),a&&i.diagnose.info("  children:",[...a.children].map(c=>f.describe(c)).join("  |  ")),i.diagnose.info("firstNormalNode:",a?f.describe(f.firstNormalNode(a)):"n/a"),i.diagnose.info("clearControl() result:",f.describe(f.clearControl()));let s=A.clearCandidates();i.diagnose.info("'clear' candidates found:",s.length),s.slice(0,12).forEach((c,u)=>{i.diagnose.info(`  [${u}] ${f.describe(c.el)}`),i.diagnose.info(`       text="${c.text.slice(0,24)}" label="${c.label}" tip="${c.tip}" pseudo=${JSON.stringify(c.pseudo).slice(0,40)}`),i.diagnose.info(`       path: ${A.path(c.el,6)}`)});let d=A.newTabButton();i.diagnose.info("newTab button:",f.describe(d)),d?.parentElement&&(i.diagnose.info("  newTab siblings:",[...d.parentElement.children].map(c=>f.describe(c)).join("  |  ")),i.diagnose.info("  newTab parent path:",A.path(d.parentElement,6))),i.diagnose.info("DOM diagnosis end")}};var h={get(e,t=""){try{return Services.prefs.getStringPref(e,t)}catch{return t}},set(e,t){try{Services.prefs.setStringPref(e,t??""),i.config.debug(`Saved preference "${e}".`)}catch(o){i.config.error(`Failed to save preference "${e}".`,o)}},apiKey(){return h.get(n.prefs.apiKey)},model(){return h.get(n.prefs.model,n.api.defaultModel)},labelStyle(){return h.get(n.prefs.labelStyle,"filled")},urlMode(){let e=h.get(n.prefs.urlMode,"detailed");return["detailed","compact","minimal"].includes(e)?e:"detailed"}};var I={collect(e){let t=y.gZenWorkspaces?.activeWorkspace??null;return p.tabs.filter(o=>{if(o.pinned||o.hidden||o.closing||!e&&o.group||o.hasAttribute("zen-empty-tab")||o.hasAttribute("zen-glance-tab"))return!1;let r=o.getAttribute("zen-workspace-id");return!(t&&r&&r!==t)})},isAlive(e){return e&&!e.closing&&e.isConnected&&p.tabs.includes(e)},title(e){return(e.label??"").slice(0,n.snapshot.titleMax)},formatUrl(e,t){if(!e||t==="minimal")return"";if(t==="compact")try{return new URL(e).hostname}catch{return""}return e.split("?")[0].split("#")[0].slice(0,n.snapshot.urlMax)},snapshot(e){let t=h.urlMode();return e.map((o,r)=>{let a={i:r,title:I.title(o)},s=I.formatUrl(o.linkedBrowser?.currentURI?.spec??"",t);s&&(a.url=s);let d=L(o.group);return d&&(a.group=d),a})}};var k={create(e,t,o){typeof p.ungroupTab=="function"&&e.filter(s=>s.group).forEach(s=>{try{p.ungroupTab(s)}catch(d){i.groups.debug("Failed to detach a tab from its current group before regrouping:",d?.message)}});let r=e[0],a=[{label:t,color:o,insertBefore:r},{label:t,color:o},{label:t,color:o,isUserTriggered:!0}];for(let s of a)try{let d=p.addTabGroup(e,s);if(!d)continue;try{t&&j(d,t),o&&K(d,o)}catch{}return!0}catch(d){i.groups.debug(`addTabGroup attempt failed for group "${t}":`,d?.message)}return i.groups.error(`Failed to create tab group "${t}" after ${a.length} attempts (${e.length} tab(s)).`),!1},apply(e){if(typeof p.addTabGroup!="function")throw new Error("gBrowser.addTabGroup is unavailable in this Zen build.");return k.reconcile(e,k.existingFor(e))},existingFor(e){let t=new Map;for(let o of e)for(let r of o.tabs){if(!I.isAlive(r))continue;let a=r.group;if(!a)continue;let s=W(L(a));s&&!t.has(s)&&t.set(s,a)}return t},reconcile(e,t){let o={realized:0,failed:0},r=new Set,a=n.grouping.colors,s=0,d=()=>{for(let m=0;m<a.length;m++){let w=a[(s+m)%a.length];if(!r.has(w))return s+=m+1,r.add(w),w}let u=a[s%a.length];return s++,r.add(u),u},c=new Set(e.map(u=>W(u.name)));for(let[u,m]of t)c.has(u)||k.dissolve(m);for(let u of e){let m=t.get(W(u.name));m&&typeof m.addTabs=="function"&&r.add(H(m))}for(let u of e){let m=u.tabs.filter(I.isAlive),w=u.tabs.length-m.length;if(w&&i.groups.warn(`Group "${u.name}": ${w} tab(s) were closed during the tidy and will be skipped.`),m.length===0){i.groups.debug(`Group "${u.name}" has no live tabs after filtering; skipping.`);continue}let T=t.get(W(u.name));if(T&&typeof T.addTabs=="function"){let E=m.filter(v=>v.group!==T);if(E.length>0){i.groups.debug(`Reusing existing group "${u.name}" in place; adding ${E.length} tab(s).`);try{T.addTabs(E)}catch(v){i.groups.warn(`Failed to add tabs to existing group "${u.name}".`,v)}}o.realized++}else{let E=d();i.groups.debug(`Creating new group "${u.name}" with ${m.length} tab(s) (color: ${E}).`),k.create(m,u.name,E)?o.realized++:o.failed++}}return o},detachAndDissolve(e,t){let o=[...F(e)].filter(I.isAlive);if(typeof p.ungroupTab=="function"&&o.forEach(r=>{try{p.ungroupTab(r)}catch(a){i.groups.debug(`Failed to detach a tab while ${t}:`,a?.message)}}),k.hasLiveTabs(e))return o.length;try{p.removeTabGroup?.(e)}catch(r){i.groups.debug(`removeTabGroup failed while ${t}:`,r?.message)}if(e.isConnected)try{e.remove()}catch{}return o.length},dissolve(e){try{e.label="",e.removeAttribute?.("label")}catch{}k.detachAndDissolve(e,"dissolving an abandoned group")},hasLiveTabs(e){return[...F(e)].some(I.isAlive)},removeEmpty(){let e=f.activeSection()||l,t=0;for(let o of[...e.querySelectorAll("tab-group")])if(!k.hasLiveTabs(o)&&!o.querySelector?.(".zen-tidy-tabs-inline-editing"))try{typeof p.removeTabGroup=="function"?p.removeTabGroup(o):o.remove(),t++}catch(r){try{o.remove(),t++}catch{i.groups.warn("Could not remove an empty tab group via API or direct DOM removal.",r)}}return t&&i.groups.debug(`Removed ${t} empty group(s) from the active workspace.`),t},scheduleEmptyCheck(){let e=0,t=()=>{k.removeEmpty(),++e<n.timing.emptyCheckMaxTries&&setTimeout(t,n.timing.emptyCheckIntervalMs)};setTimeout(t,n.timing.emptyCheckDelayMs)},installEmptyWatcher(){y.__zenTidyTabsEmptyWatcher?.disconnect?.();let e=l.getElementById("tabbrowser-tabs")||l.documentElement,t=null,o=new MutationObserver(()=>{t||(t=setTimeout(()=>{t=null,k.removeEmpty()},n.timing.emptyWatcherDebounceMs))});o.observe(e,{childList:!0,subtree:!0}),y.__zenTidyTabsEmptyWatcher=o,i.groups.debug("Empty-group watcher installed on",`${f.describe(e)}.`)}};var O={buildPrompt(e){let t=e.length,o=t-1,r=Math.min(n.grouping.maxGroups,Math.max(n.grouping.minGroups,Math.ceil(t/n.grouping.targetTabsPerGroup))),s=e.some(d=>d.group)?`
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
${t} tabs. Each object has {"i": <index 0-${o}>, "title": <string>}
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
2. Every index 0-${o} appears in EXACTLY ONE group.
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
</tabs>`},responseSchema(){return{type:"object",additionalProperties:!1,required:["groups"],properties:{groups:{type:"array",items:{type:"object",additionalProperties:!1,required:["name","tabs"],properties:{name:{type:"string"},tabs:{type:"array",items:{type:"integer"}}}}}}}},async request(e,t,o){let r=Math.min(n.api.maxTokensCeiling,Math.max(n.api.maxTokens,e.length*n.api.tokensPerTab+n.api.tokensBuffer)),a={model:o,temperature:n.api.temperature,seed:n.api.seed,max_tokens:r,messages:[{role:"system",content:O.buildPrompt(e)},{role:"user",content:O.buildUserContent(e)}]},s=[{type:"json_schema",json_schema:{name:"tidy_groups",strict:!0,schema:O.responseSchema()}},{type:"json_object"},null],d;for(let c=0;c<s.length;c++){let u=s[c]?{...a,response_format:s[c]}:{...a};try{return await O.post(u,t)}catch(m){if(m?.status===400&&/response_format|json[_ ]?schema|json/i.test(m.message??"")&&c<s.length-1){let T=s[c+1];i.ai.warn(`Model "${o}" rejected response_format=${s[c].type} (HTTP 400); retrying with ${T?T.type:"no response_format"}.`),d=m;continue}throw m}}throw d},async post(e,t){i.ai.debug(`Requesting completion from OpenRouter (model: ${e.model}, max_tokens: ${e.max_tokens}, timeout: ${n.api.timeoutMs}ms).`);let o=new AbortController,r=setTimeout(()=>o.abort(),n.api.timeoutMs),a;try{a=await fetch(n.api.endpoint,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${t}`,"HTTP-Referer":n.api.referer,"X-Title":n.api.title},body:JSON.stringify(e),signal:o.signal})}catch(s){throw s?.name==="AbortError"?(i.ai.error(`OpenRouter request aborted after exceeding the ${n.api.timeoutMs/1e3}s timeout (model: ${e.model}).`),new Error(`OpenRouter request timed out after ${n.api.timeoutMs/1e3}s`)):(i.ai.error(`Network error while contacting OpenRouter (endpoint: ${n.api.endpoint}).`,s),s)}finally{clearTimeout(r)}if(i.ai.debug(`OpenRouter responded with HTTP ${a.status}${a.statusText?` ${a.statusText}`:""}.`),!a.ok){let s=(await a.text()).slice(0,n.api.errorBodyMaxChars);i.ai.error(`OpenRouter request failed with HTTP ${a.status}. Response body (truncated): ${s}`);let d=new Error(`OpenRouter ${a.status}: ${s}`);throw d.status=a.status,d}return a.json()},extractText(e){if(e.error){let a=e.error.message||JSON.stringify(e.error);throw i.ai.error("OpenRouter returned an error payload:",a),new Error(`API error: ${a}`)}if(e.choices?.[0]?.finish_reason==="length")throw i.ai.error("Model response was truncated (finish_reason: length).","model:",e.model,"| usage:",JSON.stringify(e.usage)),new Error("Model response was truncated before completing the JSON (hit the output token limit). Try tidying fewer tabs or use a model with a larger output budget.");let t=e.choices?.[0]?.message,r=(Array.isArray(t?.content)?t.content.map(a=>a?.text??a?.content??"").join(""):t?.content??"").trim();if(!r&&t?.reasoning&&i.ai.debug("Model returned reasoning but no completion; treating as empty.",String(t.reasoning).slice(0,n.api.outputPreviewMaxChars)),!r)throw i.ai.error("Model returned an empty completion.","finish_reason:",e.choices?.[0]?.finish_reason,"| model:",e.model,"| usage:",JSON.stringify(e.usage)),new Error("Model returned empty content. Try a concrete instruct model (e.g. openai/gpt-4o-mini) instead of a free/reasoning router.");return r.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"").trim()},parseGroups(e,t){let o=()=>e.slice(0,n.api.outputPreviewMaxChars),r;try{r=JSON.parse(e)}catch{i.ai.debug("Completion was not strict JSON; extracting the first {…} block.");let v=e.match(/\{[\s\S]*\}/);if(!v)throw i.ai.error("Could not extract any JSON object from the model output (truncated):",o()),new Error(`Could not parse model output: ${o()}`);r=JSON.parse(v[0])}let a=Array.isArray(r?.groups)?r.groups:[],s=new Set,d=a.reduce((v,x)=>{let _=(Array.isArray(x?.tabs)?x.tabs:[]).map(g=>typeof g=="string"?Number(g):g).filter(g=>typeof g=="number"&&Number.isInteger(g)&&g>=0&&g<t.length&&!s.has(g)).map(g=>(s.add(g),t[g]));return _.length>0&&v.push({name:String(x?.name??"").trim()||"Group",tabs:_}),v},[]),c=d.filter(v=>v.tabs.length>=2).length,u=0,{kept:m,overflow:w}=d.reduce((v,x)=>(x.tabs.length>=2?v.kept.push(x):u<c?(v.kept.push(x),u++):v.overflow.push(...x.tabs),v),{kept:[],overflow:[]});w.length>0&&i.ai.debug(`Single-tab budget exceeded; folding ${w.length} surplus singleton tab(s) into "Other".`);let T=t.filter((v,x)=>!s.has(x));T.length>0&&i.ai.debug(`Model left ${T.length} tab(s) ungrouped; collecting them into "Other".`);let E=[...w,...T];return E.length>0&&m.push({name:"Other",tabs:E}),i.ai.debug(`Parsed model output into ${m.length} group(s) covering ${s.size+T.length} tab(s).`),m}};var b={el(e,t,o){let r=l.createElement(e);return t&&(r.className=t),o!=null&&(r.textContent=o),r},field(e,t){let o=b.el("div","zen-tidy-tabs-field");return o.append(b.el("label","zen-tidy-tabs-label",e),t),o},input(e,{type:t="text",placeholder:o=""}={}){let r=b.el("input","zen-tidy-tabs-input");return r.type=t,r.value=e??"",o&&(r.placeholder=o),r},button(e,t=""){return b.el("button",`zen-tidy-tabs-btn${t?` ${t}`:""}`,e)}};var C={keyHandler:null,open(e){C.close();let t=b.el("div","zen-tidy-tabs-overlay");t.id=n.ui.overlayId;let o=b.el("div","zen-tidy-tabs-modal");o.setAttribute("role","dialog"),o.setAttribute("aria-modal","true"),o.setAttribute("aria-label",e);let r=b.el("div","zen-tidy-tabs-modal-header");r.append(b.el("div","zen-tidy-tabs-modal-title",e));let a=b.el("button","zen-tidy-tabs-modal-close","✕");a.setAttribute("aria-label","Close"),a.addEventListener("click",C.close),r.append(a);let s=b.el("div","zen-tidy-tabs-modal-body"),d=b.el("div","zen-tidy-tabs-modal-footer");return o.append(r,s,d),t.append(o),t.addEventListener("mousedown",c=>{c.target===t&&C.close()}),C.keyHandler=c=>{c.key==="Escape"?C.close():c.key==="Tab"&&C.trapFocus(c,o)},l.addEventListener("keydown",C.keyHandler,!0),(l.documentElement||l.body).appendChild(t),requestAnimationFrame(()=>t.classList.add("open")),{overlay:t,body:s,footer:d}},trapFocus(e,t){let o=[...t.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter(d=>!d.disabled&&d.offsetParent!==null);if(o.length===0)return;let r=o[0],a=o[o.length-1],s=l.activeElement;e.shiftKey&&(s===r||!t.contains(s))?(e.preventDefault(),a.focus()):!e.shiftKey&&s===a&&(e.preventDefault(),r.focus())},close(){C.keyHandler&&(l.removeEventListener("keydown",C.keyHandler,!0),C.keyHandler=null),l.getElementById(n.ui.overlayId)?.remove()}};var M={theme:{bg:"var(--zen-main-browser-background, #1f1e25)",elevated:"var(--zen-colors-tertiary, #2a2833)",border:"var(--zen-colors-border, #3a3845)",text:"var(--zen-primary-color, #ECECEC)",muted:"#9b99a6",accent:"var(--zen-primary-color, #6c5ce7)"},labelStyleCss(){return h.labelStyle()!=="text"?"":`
      .tab-group-label {
        background: transparent !important;
        color: var(--toolbox-textcolor, var(--toolbar-color, currentColor)) !important;
        opacity: .9;
        font-weight: 700 !important;
        letter-spacing: .01em;
        text-shadow: none !important;
      }
      .tab-group-label:hover { opacity: 1; }
    `},inject(){let e=M.theme;l.getElementById(n.ui.styleId)?.remove();let t=l.createElement("style");t.id=n.ui.styleId,t.textContent=`
      #${n.ui.controlId} {
        cursor: pointer;
        color: inherit !important;
        font: inherit !important;
        background: none !important;
        border: none !important;
        box-shadow: none !important;
      }
      #${n.ui.controlId}::before { content: none !important; }
      #${n.ui.controlId}.zen-tidy-tabs-fallback {
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
      .zen-workspace-tabs-section:hover #${n.ui.controlId}.zen-tidy-tabs-fallback { opacity: .85; }
      #${n.ui.controlId}.zen-tidy-tabs-fallback:hover { opacity: 1; }

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

      ${M.labelStyleCss()}
    `,(l.head||l.documentElement).appendChild(t),i.styles.debug(`Stylesheet injected (#${n.ui.styleId}, labelStyle: ${h.labelStyle()}).`)}};var G={segmentedControl(e,t,o){let r=t,a=b.el("div","zen-tidy-tabs-segment");return e.forEach(([s,d])=>{let c=b.el("button","zen-tidy-tabs-seg",d);s===t&&c.classList.add("active"),c.addEventListener("click",()=>{r=s,a.querySelectorAll(".zen-tidy-tabs-seg").forEach(u=>{u.classList.remove("active")}),c.classList.add("active"),o?.(s)}),a.append(c)}),{el:a,get:()=>r}},settings(){let{body:e,footer:t}=C.open("Zen Tidy Tabs Settings");i.user.debug("Opened the settings modal.");let o=b.input(h.apiKey(),{type:"password",placeholder:"sk-or-v1-..."}),r=b.input(h.model(),{placeholder:n.api.defaultModel}),a=G.segmentedControl([["filled","Colored"],["text","Text only"]],h.labelStyle()),s={detailed:"The tab's title and full URL are sent to the AI.",compact:"The tab's title and hostname are sent to the AI.",minimal:"Only the tab's title is sent to the AI."},d=b.el("p","zen-tidy-tabs-privacy-note",s[h.urlMode()]??s.detailed),c=G.segmentedControl([["detailed","Detailed"],["compact","Compact"],["minimal","Minimal"]],h.urlMode(),x=>{d.textContent=s[x]??s.detailed}),u=b.el("p","zen-tidy-tabs-hint");u.append(l.createTextNode("Key is stored locally. Get one at "));let m="https://openrouter.ai/keys",w=b.el("a","zen-tidy-tabs-link","openrouter.ai/keys");w.href=m;let T=x=>{x?.preventDefault(),C.close(),typeof y.openTrustedLinkIn=="function"?y.openTrustedLinkIn(m,"tab"):typeof p.addTrustedTab=="function"?p.selectedTab=p.addTrustedTab(m):i.user.error(`Could not open ${m}: no trusted-link API is available in this build.`)};w.addEventListener("click",T),w.addEventListener("keydown",x=>{x.key===" "&&T(x)}),u.append(w,l.createTextNode(".")),e.append(b.field("OpenRouter API key",o),b.field("Model",r),b.field("Group labels",a.el),b.field("Tab info sent to AI",c.el),d,u);let E=b.button("Cancel","ghost");E.addEventListener("click",C.close);let v=b.button("Save settings","primary");v.addEventListener("click",()=>{h.set(n.prefs.apiKey,o.value.trim()),h.set(n.prefs.model,r.value.trim()),h.set(n.prefs.labelStyle,a.get()),h.set(n.prefs.urlMode,c.get()),i.user.info(`Settings saved (model: ${r.value.trim()||n.api.defaultModel}, labelStyle: ${a.get()}, urlMode: ${c.get()}, apiKey: ${o.value.trim()?"set":"empty"}).`),M.inject(),C.close(),$.notify("Settings saved.")}),t.append(b.el("div","zen-tidy-tabs-spacer"),E,v),o.focus()}};var z={build(e){let t=l.createElement(e?e.tagName:"span");t.id=n.ui.controlId,t.textContent=n.ui.label,t.setAttribute("label",n.ui.label),t.setAttribute("tooltiptext",n.ui.tooltip),t.title=n.ui.tooltip,t.className=e?e.className:"zen-tidy-tabs-fallback",e&&(t.classList.remove(n.ui.clearButtonClass),t.dataset.twin="1");let o=r=>{r.preventDefault(),r.stopPropagation(),i.user.debug("Tidy control activated (click / command)."),$.runTidy()};return t.addEventListener("click",o),t.addEventListener("command",o),t.addEventListener("contextmenu",r=>{r.preventDefault(),r.stopPropagation(),i.user.debug("Tidy control right-clicked; opening settings."),G.settings()}),t},twinIsCurrent(){let e=l.getElementById(n.ui.controlId);if(!(e?.dataset?.twin==="1"&&e.isConnected))return!1;let t=f.clearControl();return!!t&&e.parentElement===t.parentElement&&e.nextElementSibling===t},placeTwinIfClearPresent(){if(z.twinIsCurrent())return!0;let e=f.clearControl();return e?.parentElement?(l.getElementById(n.ui.controlId)?.remove(),e.parentElement.insertBefore(z.build(e),e),i.dom.info(`Tidy control mounted as a twin of the Clear button (${f.describe(e)}).`),!0):!1},installClearWatcher(){let e=y.__zenTidyTabsClearWatcher;if(e?.token===B)return;e&&e.target.removeEventListener("mouseover",e.handler,!0);let t=l.documentElement,o=()=>{let r=l.getElementById(n.ui.controlId);r?.dataset?.twin==="1"&&r.isConnected&&r.nextElementSibling&&D(r.nextElementSibling)&&f.activeWorkspaceEl()?.contains(r)||z.placeTwinIfClearPresent()};t.addEventListener("mouseover",o,!0),y.__zenTidyTabsClearWatcher={token:B,target:t,handler:o},i.dom.debug("Clear-button hover watcher installed on",`${f.describe(t)}.`)},installWorkspaceWatcher(){let e=y.__zenTidyTabsWorkspaceWatcher;if(e?.token===B)return;let t=y.gZenWorkspaces;if(typeof t?.addChangeListeners!="function")return;e&&t.removeChangeListeners?.(e.listener);let o=()=>z.mount();t.addChangeListeners(o,{once:!1}),y.__zenTidyTabsWorkspaceWatcher={token:B,listener:o},i.dom.debug("Workspace-change watcher installed; Tidy control will follow the active workspace.")},mount(){if(z.installClearWatcher(),z.installWorkspaceWatcher(),z.placeTwinIfClearPresent())return!0;let e=l.getElementById(n.ui.controlId),t=f.activeSection();if(e&&t&&!t.contains(e)&&e.remove(),!l.getElementById(n.ui.controlId)){let o=t&&f.firstNormalNode(t);if(o?.parentElement)return o.parentElement.insertBefore(z.build(null),o),i.dom.info("Tidy control mounted via separator fallback (hover to reveal; will upgrade to a Clear twin when one appears)."),!0}return i.dom.debug("No mount target available yet; will retry or wait for a hover."),!!l.getElementById(n.ui.controlId)},setBusy(e){let t=l.getElementById(n.ui.controlId);t&&(t.textContent=e?n.ui.busyLabel:n.ui.label,t.setAttribute("label",e?n.ui.busyLabel:n.ui.label),t.style.pointerEvents=e?"none":"")}};var $={running:!1,notify(e,t=!1){(t?i.tidy.error:i.tidy.info)(e);try{let o=p.getNotificationBox(),r=o.appendNotification(n.ui.notificationValue,{label:`Zen Tidy Tabs: ${e}`,priority:t?o.PRIORITY_WARNING_HIGH:o.PRIORITY_INFO_LOW},[]);Promise.resolve(r).then(a=>{a&&setTimeout(()=>o.removeNotification(a),n.timing.notifyDurationMs)})}catch{}},async runTidy(){if($.running){i.tidy.debug("Ignoring Tidy request: a tidy run is already in progress.");return}let e=h.apiKey();if(!e){i.tidy.warn("Tidy aborted: no OpenRouter API key configured."),$.notify(`Set your key in about:config → ${n.prefs.apiKey}`,!0);return}let t=I.collect(!0);if(t.length<n.grouping.minTabs){i.tidy.warn(`Tidy aborted: only ${t.length} eligible tab(s), need at least ${n.grouping.minTabs}.`),$.notify(`Need at least ${n.grouping.minTabs} tabs to tidy.`,!0);return}$.running=!0,z.setBusy(!0);try{i.tidy.info(`Starting tidy of ${t.length} tab(s) (model: ${h.model()}, urlMode: ${h.urlMode()}).`);let o=await O.request(I.snapshot(t),e,h.model()),r=O.parseGroups(O.extractText(o),t);i.tidy.info("Grouping plan:",r.map(d=>`${d.name}(${d.tabs.length})`).join(", "));let{realized:a,failed:s}=k.apply(r);k.scheduleEmptyCheck(),s===0?(i.tidy.info(`Tidy complete: sorted ${t.length} tab(s) into ${a} group(s).`),$.notify(`Sorted ${t.length} tabs into ${a} groups.`)):a>0?(i.tidy.warn(`Tidy partially complete: created ${a} group(s), ${s} could not be created.`),$.notify(`Sorted ${t.length} tabs into ${a} groups; ${s} could not be created.`,!0)):(i.tidy.error(`Tidy failed: none of the ${r.length} group(s) could be created.`),$.notify("Tidy failed: no groups could be created.",!0))}catch(o){i.tidy.error("Tidy run failed.",o),$.notify(`Tidy failed: ${o.message||o}`,!0)}finally{$.running=!1,z.setBusy(!1)}}};var P={customize(){n.panel.hideSaveAndClose&&P.hideSaveAndClose(),n.panel.overrideUngroup&&P.installUngroupOverride()},hideSaveAndClose(){let e=l.getElementById(n.panel.ids.saveAndClose);e&&(e.hidden=!0)},installUngroupOverride(){if(y.__zenTidyTabsPanelOverride)return;let e=p.tabGroupMenu?.panel;if(!e)return;let t=o=>{o.target?.id===n.panel.ids.ungroup&&(o.preventDefault(),o.stopPropagation(),P.ungroup(p.tabGroupMenu?.activeGroup))};e.addEventListener("command",t,!0),y.__zenTidyTabsPanelOverride={panel:e,onCommand:t},i.user.debug("Installed 'Ungroup tabs' override on the native panel.")},uninstall(){let e=y.__zenTidyTabsPanelOverride;if(e){try{e.panel.removeEventListener("command",e.onCommand,!0)}catch{}y.__zenTidyTabsPanelOverride=null}},ungroup(e){if(!e)return;let t=L(e),o=k.detachAndDissolve(e,`ungrouping "${t}"`);try{p.tabGroupMenu?.close?.()}catch{}i.user.info(`Ungrouped ${o} tab(s) from "${t}".`)}};var J="http://www.w3.org/1999/xhtml",S={active:null,install(){let e=y.__zenTidyTabsEditorListeners;e&&(l.removeEventListener("click",e.onClick,!0),l.removeEventListener("contextmenu",e.onContextMenu,!0)),S.cancelInline(),l.querySelectorAll(".zen-tidy-tabs-inline-input").forEach(r=>{let a=r.previousElementSibling;a?.tagName?.toLowerCase()==="span"&&a.remove(),r.remove()}),l.querySelectorAll(".zen-tidy-tabs-inline-editing").forEach(r=>{r.style.removeProperty("display"),r.classList.remove("zen-tidy-tabs-inline-editing")}),l.documentElement.classList.remove("zen-tidy-tabs-editing"),P.uninstall();let t=r=>{if(r.button!==0)return;if(r.target?.closest?.(".zen-tidy-tabs-inline-input")){r.stopPropagation();return}let a=r.target?.closest?.(".tab-group-label");if(!a)return;let s=a.closest("tab-group");s&&(r.preventDefault(),r.stopPropagation(),S.startInline(s,a))},o=r=>{let a=r.target?.closest?.(".tab-group-label, .zen-tidy-tabs-inline-input");if(!a)return;let s=a.closest("tab-group");s&&(r.preventDefault(),r.stopPropagation(),S.cancelInline(),setTimeout(()=>{try{p.tabGroupMenu?.openEditModal(s),P.customize()}catch(d){i.user.error("Failed to open Zen's native group edit panel.",d)}},0))};l.addEventListener("click",t,!0),l.addEventListener("contextmenu",o,!0),y.__zenTidyTabsEditorListeners={onClick:t,onContextMenu:o},i.user.debug("Group label editor installed.")},startInline(e,t){if(S.active?.labelEl===t){S.active.input.focus();return}S.cancelInline();let o=L(e),r=l.createElementNS(J,"input");r.className="zen-tidy-tabs-inline-input",r.value=o,r.setAttribute("aria-label","Rename group");let a=getComputedStyle(t);["fontFamily","fontSize","fontWeight","fontStyle","letterSpacing","lineHeight","color","backgroundColor","backgroundImage","paddingTop","paddingRight","paddingBottom","paddingLeft","borderRadius","height","textAlign","textShadow"].forEach(g=>{r.style[g]=a[g]});let d=l.createElementNS(J,"span");d.style.position="absolute",d.style.visibility="hidden",d.style.whiteSpace="pre",d.style.pointerEvents="none",["fontFamily","fontSize","fontWeight","fontStyle","letterSpacing"].forEach(g=>{d.style[g]=a[g]});let u=2,m=8,w=()=>{d.textContent=r.value??"";let g=Math.ceil(d.getBoundingClientRect().width)+u;r.style.width=`${Math.max(g,m)}px`};r.style.boxSizing="content-box",r.style.flex="0 0 auto",t.classList.add("zen-tidy-tabs-inline-editing"),l.documentElement.classList.add("zen-tidy-tabs-editing"),t.style.display="none",t.parentNode.insertBefore(r,t),r.parentNode.insertBefore(d,r),w();let T=!1,E=g=>{if(T)return;T=!0;let R=r.value.trim();if(S.finishInline(),g&&R&&R!==o)try{j(e,R),i.user.info(`Renamed group "${o}" to "${R}".`)}catch(Y){i.user.error(`Failed to rename group "${o}" to "${R}".`,Y)}},v=g=>{g.key==="Enter"?(g.preventDefault(),E(!0)):g.key==="Escape"&&(g.preventDefault(),E(!1)),g.stopPropagation()},x=()=>E(!0),_=g=>{g.target===r||r.contains(g.target)||E(!0)};r.addEventListener("input",w),r.addEventListener("keydown",v,!0),r.addEventListener("blur",x),l.addEventListener("mousedown",_,!0),S.active={input:r,labelEl:t,group:e,original:o,discard:()=>E(!1),cleanup:()=>{d.remove(),r.removeEventListener("input",w),r.removeEventListener("keydown",v,!0),r.removeEventListener("blur",x),l.removeEventListener("mousedown",_,!0)}},r.focus(),r.select()},finishInline(){let e=S.active;e&&(S.active=null,e.cleanup?.(),e.input.remove(),l.documentElement.classList.remove("zen-tidy-tabs-editing"),e.labelEl.style.removeProperty("display"),e.labelEl.classList.remove("zen-tidy-tabs-inline-editing"))},cancelInline(){S.active?.discard?.()}};var V=()=>{if(i.init.info("Loading Zen Tidy Tabs…"),i.init.debug("location:",(()=>{try{return location.href}catch{return"?"}})()),i.init.debug(`Environment: gBrowser.addTabGroup is ${typeof p.addTabGroup}, ${p.tabs.length} tab(s) open.`),M.inject(),S.install(),k.installEmptyWatcher(),n.debug&&A.run(),!z.mount()){let e=0,t=setInterval(()=>{(z.mount()||++e>n.timing.mountMaxAttempts)&&(clearInterval(t),l.getElementById(n.ui.controlId)||i.dom.warn(`Tidy control not placed after ${e} attempt(s); it will appear when you hover the tab separator.`))},n.timing.mountRetryMs)}y.zenTidyTabs={run:()=>$.runTidy(),settings:()=>G.settings(),mount:()=>z.mount(),diagnose:()=>A.run(),injectStyles:()=>M.inject(),collect:(e=!0)=>I.collect(e)},i.init.info("Ready — left-click the Tidy control to organize tabs; right-click it for settings.")};V();})();
