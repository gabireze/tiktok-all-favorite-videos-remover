chrome.runtime.onMessage.addListener(async function (
  request,
  sender,
  sendResponse
) {
  if (request.action === "removeFavoriteVideos") {
    try {
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        files: ["script.js"],
      });
    } catch (error) {
      console.log({ message: "Error starting removal process.", error: error });
    }
  }
});
