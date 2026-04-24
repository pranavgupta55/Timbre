"use client";

const INTERRUPTED_PLAY_MESSAGE_FRAGMENTS = [
  "The play() request was interrupted by a call to pause()",
  "The play() request was interrupted by a new load request",
  "The fetching process for the media resource was aborted by the user agent at the user's request",
];

export const isMediaPlayInterruptionError = (error: unknown) =>
  error instanceof DOMException &&
  (error.name === "AbortError" ||
    INTERRUPTED_PLAY_MESSAGE_FRAGMENTS.some((fragment) => error.message.includes(fragment)));

export const playMediaSafely = async (media: HTMLMediaElement) => {
  try {
    await media.play();
    return true;
  } catch (error) {
    if (isMediaPlayInterruptionError(error)) {
      return false;
    }

    throw error;
  }
};
