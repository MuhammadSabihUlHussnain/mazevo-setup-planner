// Toolbar button: open the planner report next to the current tab.
const api = globalThis.browser || globalThis.chrome;

api.action.onClicked.addListener((tab) => {
  let url = api.runtime.getURL('report.html');
  if (tab && tab.url && /^https:\/\/[^/]*\.mymazevo\.com\//.test(tab.url)) {
    url += '?tab=' + tab.id;
  }
  api.tabs.create({ url, index: tab ? tab.index + 1 : undefined });
});
