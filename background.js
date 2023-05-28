chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.action === "startRemoval") {
    chrome.tabs.query({ active: true }, function (tabs) {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: startFunction,
      });
    });
  }
});

const startFunction = async () => {
  try {
    console.log("Start function");
    let favoriteTabButton =
      document.querySelector(".tiktok-euqeq6-PFavorite") ??
      document.querySelector(".tiktok-azvt7w-PFavorite");
    if (favoriteTabButton) {
      if (favoriteTabButton.className.includes("tiktok-euqeq6-PFavorite")) {
        favoriteTabButton.click();
        console.log("Favorite tab opened");
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    } else {
      console.log("Favorite tab not found");
      return;
    }

    let firstFavoriteVideo = document.getElementsByClassName(
      "tiktok-yz6ijl-DivWrapper"
    )[0];
    if (firstFavoriteVideo) {
      firstFavoriteVideo.getElementsByTagName("a")[0].click();
      console.log("First favorite video opened");
    } else {
      console.log("You have no favorites");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const interval = setInterval(() => {
      let nextVideoButton = document.querySelector(
        ".tiktok-1sltbs0-ButtonBasicButtonContainer-StyledVideoSwitch"
      );
      let actionButtons = document.querySelector(
        ".tiktok-1d39a26-DivFlexCenterRow"
      );
      if (actionButtons) {
        let favoriteButton = actionButtons.getElementsByTagName("button")[2];
        favoriteButton.click();
        console.log("Favorite removed");
      } else {
        clearInterval(interval);
        console.log("No more favorites, stopping script");
        return;
      }
      if (nextVideoButton && !nextVideoButton.disabled) {
        nextVideoButton.click();
        console.log("Next favorite clicked");
      } else {
        clearInterval(interval);
        console.log("No more favorites, stopping script");
        return;
      }
    }, 2000);
  } catch (error) {
    console.log(error);
  }
};
