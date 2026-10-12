// Toolbar button: open the planner report next to the current tab.
chrome.action.onClicked.addListener((tab) => {
  let url = chrome.runtime.getURL('report.html');
  if (tab && tab.url && /^https:\/\/[^/]*\.mymazevo\.com\//.test(tab.url)) {
    url += '?tab=' + tab.id;
  }
  chrome.tabs.create({ url, index: tab ? tab.index + 1 : undefined });
});
