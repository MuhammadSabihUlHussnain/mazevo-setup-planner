// Opens the planner report next to a tab: from the toolbar button, or from
// the "Plan setups" button on the Mazevo page.
const api = globalThis.browser || globalThis.chrome;

function openReport(tab) {
  let url = api.runtime.getURL('report.html');
  if (tab && tab.url && /^https:\/\/[^/]*\.mymazevo\.com\//.test(tab.url)) {
    url += '?tab=' + tab.id;
  }
  api.tabs.create({ url, index: tab ? tab.index + 1 : undefined });
}

api.action.onClicked.addListener(openReport);

api.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'openReport' && sender.tab) openReport(sender.tab);
});
