chrome.runtime.onMessage.addListener(async function (request, sender, sendResponse) {
  if (request.action === "startRemoval") {
    try {
      const tabs = await chrome.tabs.query({ active: true });
      await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: startFunction,
      });
    } catch (error) {
      console.log("Error starting removal:", error);
    }
  }
});

const startFunction = async () => {
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
          stopScript("Favorite tab not found");
          return;
        }
        favoriteTab.click();
        console.log("Favorite tab opened");
        await sleep(5000);
      } else {
        stopScript("DivVideoFeedTab not found");
        return;
      }
    } catch (error) {
      stopScript("Error finding or clicking favorite tab:", error);
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
        console.log("First favorite video opened");
        await sleep(5000);
      } else {
        stopScript("You have no favorites");
        return;
      }
    } catch (error) {
      stopScript("Error finding or clicking favorite video", error);
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
          stopScript("Error finding favorite button");
          return;
        }
        favoriteButton.click();
        console.log("Favorite removed");
        if (!nextVideoButton || nextVideoButton.disabled) {
          clearInterval(interval);
          stopScript("No more favorites");
          return;
        }
        nextVideoButton.click();
        console.log("Next favorite clicked");
      }, 2000);
    } catch (error) {
      stopScript("Error clicking next favorite", error);
    }
  };

  const stopScript = (message, error = "") => {
    error ? console.log({ message: `${message}, stopping script.`, error: error }) : console.log(`${message}, stopping script.`);
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  try {
    console.log("Start function");
    await clickFavoriteTab();
    await clickFavoriteVideo();
    await clickNextFavoriteAndRemove();
  } catch (error) {
    console.log("Error in start function:", error);
  }
};
