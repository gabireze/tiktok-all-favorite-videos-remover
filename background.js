chrome.runtime.onMessage.addListener(async function (request, sender, sendResponse) {
  if (request.action === "removeLikedVideos") {
    try {
      const tabs = await chrome.tabs.query({ active: true });
      await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: initiateFavoriteVideosRemoval,
      });
    } catch (error) {
      console.log({ message: "Error starting removal process.", error: error });
    }
  }
});

const initiateFavoriteVideosRemoval = async () => {
  const clickFavoriteTab = async () => {
    try {
      let elements = document.querySelectorAll('[class^="tiktok"]');
      let elementsArray = Array.from(elements);
      let divVideoFeedTab = elementsArray.find((element) => {
        let className = String(element.className);
        if (className.includes("DivVideoFeedTab")) {
          return element;
        }
      });
      if (divVideoFeedTab) {
        let favoriteTab = divVideoFeedTab.querySelector("p:nth-of-type(2)");
        if (!favoriteTab) {
          stopScript("'Favorites' tab not found on the page");
          return;
        }
        favoriteTab.click();
        console.log("Successfully opened the 'Favorites' tab.");
        await sleep(5000);
      } else {
        stopScript("The 'Favorites' tab container not found on the page");
        return;
      }
    } catch (error) {
      stopScript("Error finding or clicking the 'Favorites' tab", error);
    }
  };

  const clickFavoriteVideo = async () => {
    try {
      let elements = document.querySelectorAll('[class^="tiktok"]');
      let elementsArray = Array.from(elements);
      let firstVideo = elementsArray.find((element) => {
        let className = String(element.className);
        if (className.includes("DivPlayerContainer")) {
          return element;
        }
      });
      if (firstVideo) {
        firstVideo.click();
        console.log("Successfully opened the first favorite video.");
        await sleep(5000);
      } else {
        stopScript("No favorite videos found. Your favorite videos list is empty");
        return;
      }
    } catch (error) {
      stopScript("Error finding or clicking the first favorite video", error);
    }
  };

  const clickNextFavoriteAndRemove = async () => {
    try {
      let elements = document.querySelectorAll('[class^="tiktok"]');
      let elementsArray = Array.from(elements);
      let nextVideoButton = elementsArray.filter((element) => {
        let className = String(element.className);
        if (className.includes("ButtonBasicButtonContainer-StyledVideoSwitch")) {
          return element;
        }
      })[1];
      let favoriteButton = elementsArray
        .find((element) => {
          let className = String(element.className);
          if (className.includes("DivFlexCenterRow-StyledWrapper")) {
            return element;
          }
        })
        .getElementsByTagName("button")[2];
      const interval = setInterval(() => {
        if (!favoriteButton) {
          clearInterval(interval);
          stopScript("Could not find the favorite button");
          return;
        }
        favoriteButton.click();
        console.log("Successfully removed the favorite from the current video.");
        if (!nextVideoButton || nextVideoButton.disabled) {
          clearInterval(interval);
          closeVideo();
          return;
        }
        nextVideoButton.click();
        console.log("Clicked the next liked video.");
      }, 2000);
    } catch (error) {
      stopScript("Could not click next favorite video", error);
    }
  };

  const closeVideo = async () => {
    try {
      let elements = document.querySelectorAll('[class^="tiktok"]');
      let elementsArray = Array.from(elements);
      let closeVideoButton = elementsArray.find((element) => {
        let className = String(element.className);
        if (className.includes("ButtonBasicButtonContainer-StyledCloseIconContainer")) {
          return element;
        }
      });
      if (closeVideoButton) {
        closeVideoButton.click();
        console.log("Successfully closed the video.");
        stopScript("Script completed: All actions executed successfully");
        return;
      } else {
        stopScript("Could not find the close video button");
        return;
      }
    } catch (error) {
      stopScript("Could not close video", error);
    }
  };

  const stopScript = (message, error = "") => {
    error ? console.log({ message: `${message}. Stopping script...`, error: error }) : console.log(`${message}. Stopping script...`);
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  try {
    console.log("Script started: Initiating actions...");
    await clickFavoriteTab();
    await clickFavoriteVideo();
    await clickNextFavoriteAndRemove();
  } catch (error) {
    stopScript("Error in script", error);
  }
};
