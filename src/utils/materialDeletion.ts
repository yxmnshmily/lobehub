const listeners = new Set<() => void>();

/** Publish only after the server has confirmed deletion. No file contents are broadcast. */
export const notifyMaterialDeletion = () => {
  for (const listener of listeners) listener();
};

export const subscribeMaterialDeletion = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
