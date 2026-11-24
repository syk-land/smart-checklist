self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {
    title: '체크리스트 알림',
    body: '마감 기한이 다가오는 할일이 있습니다.',
    url: '/',
    tag: 'checklist-push',
    todoId: null,
    userId: null,
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = { ...payload, ...parsed };
    } catch {
      payload.body = event.data.text();
    }
  }

  // 알림 하단 액션 버튼:
  // 아침 브리핑 알림(morning_)이거나 특정 할일이 지정되지 않은 경우 [확인] 버튼만 제공
  // 개별 할일 마감 알림(todoId가 있는 경우)은 [확인]과 [처리완료] 모두 제공
  const isMorningBriefing = (payload.tag && payload.tag.startsWith('morning_')) || !payload.todoId;
  const actions = isMorningBriefing
    ? [{ action: 'dismiss', title: '확인' }]
    : [
        { action: 'dismiss', title: '확인' },
        { action: 'complete', title: '처리완료' },
      ];

  const options = {
    body: payload.body,
    icon: '/vite.svg',
    badge: '/vite.svg',
    tag: payload.tag || `todo-${Date.now()}`,
    renotify: true,
    requireInteraction: true,
    data: {
      url: payload.url || '/',
      todoId: payload.todoId,
      userId: payload.userId,
    },
    actions,
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const action = event.action;
  const data = event.notification.data || {};
  const targetUrl = data.url || '/';
  const { todoId, userId } = data;

  // 1) [확인] 버튼: 알림만 지우고 종료
  if (action === 'dismiss') {
    return;
  }

  // 2) [처리완료] 버튼: 알림 지우고 Firestore에서 해당 할일 완료(completed=true) 처리
  if (action === 'complete') {
    const completePromise = (async () => {
      if (todoId && userId) {
        try {
          await fetch('/api/push/complete-todo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, todoId }),
          });
        } catch (e) {
          console.error('[SW complete error]', e);
        }
      }

      // 열려 있는 웹 창이 있다면 즉시 완료 반영 메시지 전달
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientList) {
        client.postMessage({ type: 'TODO_COMPLETED_VIA_NOTIFICATION', todoId });
      }
    })();

    event.waitUntil(completePromise);
    return;
  }

  // 3) 알림 본체 클릭 시: 해당 웹 페이지 열기/포커스
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
