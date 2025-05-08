const initiateFavoriteVideosRemoval = async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const clickProfileTab = async () => {
    try {
      const profileButton = document.querySelector('[data-e2e="nav-profile"]');
      if (!profileButton) {
        stopScript("The 'Profile' button was not found on the page");
        return false;
      }
      profileButton.click();
      console.log("Successfully clicked the 'Profile' button.");
      await sleep(5000);
      return true;
    } catch (error) {
      stopScript("Error clicking the 'Profile' button", error);
      return false;
    }
  };

  const clickFavoriteTab = async () => {
    try {
      const favoriteTab = document.querySelector('[class*="PFavorite"]');
      if (!favoriteTab) {
        stopScript("The 'Favorites' tab was not found on the page");
        return;
      }
      favoriteTab.click();
      console.log("Successfully opened the 'Favorites' tab.");
      await sleep(5000);
    } catch (error) {
      stopScript("Error clicking the 'Favorites' tab", error);
    }
  };

  const clickFavoriteVideo = async () => {
    try {
      const firstVideo = document.querySelector(
        '[class*="DivPlayerContainer"]'
      );
      if (!firstVideo) {
        stopScript(
          "No favorite videos found. Your favorite list may be empty."
        );
        return;
      }
      firstVideo.click();
      console.log("Successfully opened the first favorite video.");
      await sleep(5000);
    } catch (error) {
      stopScript("Error opening the first favorite video", error);
    }
  };

  const clickNextFavoriteAndRemove = async () => {
    try {
      const interval = setInterval(async () => {
        const nextVideoButton = document.querySelector(
          '[data-e2e="arrow-right"]'
        );
        const favoriteButton = document.querySelector(
          '[data-e2e="undefined-icon"]'
        );

        if (!favoriteButton) {
          clearInterval(interval);
          stopScript("Favorite button not found");
          return;
        }

        favoriteButton.click();
        console.log("Removed favorite from current video.");

        if (!nextVideoButton || nextVideoButton.disabled) {
          clearInterval(interval);
          closeVideo();
          return;
        }

        nextVideoButton.click();
        console.log("Moved to next favorite video.");
      }, 2000);
    } catch (error) {
      stopScript("Error during favorite video removal", error);
    }
  };

  const closeVideo = async () => {
    try {
      const closeVideoButton = document.querySelector(
        '[data-e2e="browse-close"]'
      );
      if (closeVideoButton) {
        closeVideoButton.click();
        console.log("Closed video view.");
        stopScript("All actions executed successfully");
      } else {
        stopScript("Could not find the close video button");
      }
    } catch (error) {
      stopScript("Error closing the video", error);
    }
  };

  const stopScript = (message, error = "") => {
    let logMessage = `${message}. Reloading page...`;
    if (error) {
      console.log({ message: logMessage, error });
    } else {
      console.log(logMessage);
    }
    setTimeout(() => window.location.reload(), 1000);
  };

  try {
    console.log("Script started...");
    const wentToProfile = await clickProfileTab();
    if (!wentToProfile) return;
    await clickFavoriteTab();
    await clickFavoriteVideo();
    await clickNextFavoriteAndRemove();
  } catch (error) {
    stopScript("Unexpected error in main flow", error);
  }
};

initiateFavoriteVideosRemoval();
