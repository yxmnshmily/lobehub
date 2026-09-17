import { Suspense } from 'react';
import { useParams } from 'react-router';

import SurfaceSkeleton from '@/components/Skeleton/Surface';
import { useGroupWorkRequest } from '@/features/SuperGroup/useGroupWorkRequest';
import Portal from '@/routes/(main)/agent/features/Portal/features/Portal';
import PortalPanel from '@/routes/(main)/agent/features/Portal/features/PortalPanel';

const ChatPortal = () => {
  const { gid } = useParams<{ gid: string }>();
  const detailOwnsPortal = useGroupWorkRequest(
    (s) => s.request?.groupId === gid && !!s.request?.detail,
  );
  // Embedded goal/task details already host this shared portal stack.
  if (detailOwnsPortal) return null;

  return (
    <Portal>
      <Suspense fallback={<SurfaceSkeleton header={false} variant={'list'} />}>
        <PortalPanel mobile={false} />
      </Suspense>
    </Portal>
  );
};

export default ChatPortal;
