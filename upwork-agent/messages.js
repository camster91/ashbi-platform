// ALL modes — unified Upwork message inbox

export async function scrapeMessages(page) {
  await page.goto('https://www.upwork.com/messages/rooms', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  const messages = await page.evaluate(() => {
    const rooms = document.querySelectorAll('div[class*="room-item"], li[class*="thread"], div[data-test="room"], .air3-card-section');
    return Array.from(rooms).slice(0, 20).map(el => {
      const senderEl = el.querySelector('span[class*="name"], h4, strong, [data-test="room-user-name"]');
      const previewEl = el.querySelector('span[class*="preview"], p[class*="message"], [data-test="room-last-message"], .text-body-sm');
      const timeEl = el.querySelector('time, span[class*="time"], small[class*="time"]');
      const urlEl = el.querySelector('a[href*="messages"]');
      const unreadEl = el.querySelector('span[class*="unread"], span[class*="badge"], .unread-indicator');
      return {
        sender: senderEl?.textContent?.trim() || '',
        preview: previewEl?.textContent?.trim()?.slice(0, 200) || '',
        timestamp: timeEl?.textContent?.trim() || '',
        roomUrl: urlEl?.href || '',
        isUnread: !!unreadEl,
        type: 'unknown', // will be inferred
      };
    });
  });

  return messages.filter(m => m.sender && m.isUnread);
}
