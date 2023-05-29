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
      const favoriteTabButton = document.querySelector(".tiktok-euqeq6-PFavorite") ?? document.querySelector(".tiktok-azvt7w-PFavorite");
      if (favoriteTabButton) {
        if (favoriteTabButton.className.includes("tiktok-euqeq6-PFavorite")) {
          favoriteTabButton.click();
          console.log("Favorite tab opened");
          await sleep(5000);
        }
      } else {
        console.log("Favorite tab not found");
      }
    } catch (error) {
      console.log("Error clicking favorite tab:", error);
    }
  };

  const clickFavoriteVideo = async () => {
    try {
      const firstFavoriteVideo = document.querySelectorAll(".tiktok-yz6ijl-DivWrapper")[0];
      if (firstFavoriteVideo) {
        firstFavoriteVideo.querySelector("a").click();
        console.log("First favorite video opened");
      } else {
        console.log("You have no favorites");
      }
    } catch (error) {
      console.log("Error clicking favorite video:", error);
    }
  };

  const clickNextFavoriteAndRemove = async () => {
    try {
      const interval = setInterval(() => {
        const nextVideoButton = document.querySelector(".tiktok-1sltbs0-ButtonBasicButtonContainer-StyledVideoSwitch");
        const actionButtons = document.querySelector(".tiktok-1d39a26-DivFlexCenterRow");
        if (actionButtons) {
          const favoriteButton = actionButtons.getElementsByTagName("button")[2];
          favoriteButton.click();
          console.log("Favorite removed");
        } else {
          clearInterval(interval);
          stopScript("No more favorites");
        }
        if (nextVideoButton && !nextVideoButton.disabled) {
          nextVideoButton.click();
          console.log("Next favorite clicked");
        } else {
          clearInterval(interval);
          stopScript("No more favorites");
        }
      }, 2000);
    } catch (error) {
      console.log("Error clicking next favorite:", error);
    }
  };

  const stopScript = (message) => {
    console.log(`${message}, stopping script`);
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
