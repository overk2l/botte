// sendReactionRole.js
const fetch = require('node-fetch');

const webhookURL = 'YOUR_WEBHOOK_URL_HERE'; // Paste your webhook URL here

const payload = {
  content: null,
  embeds: [
    {
      title: "Choose Your Colour & Ping Roles!・⇲",
      description: `
✨ Express yourself with a custom color! ✨
Choose the color that best fits your vibe — you can change it anytime below.

Notification Roles – Stay updated with what matters:
📢 ・➤ [Announcement Ping] — Get pings for updates.
⚔️ ・➤ [War Ping] — Get pinged for a war.
🧑🏻‍🤝‍🧑🏻 ・➤ [Teamer Ping] — Get pinged for teamers.

⬇️ Choose colour & ping roles below! ⬇️
      `,
      color: 0x0099ff,
    }
  ],
  components: [
    {
      type: 1, // Action Row
      components: [
        {
          type: 3, // Select Menu (dropdown)
          custom_id: 'select_color_role',
          placeholder: '🎨 Select a colour...',
          options: [
            {
              label: 'Red',
              description: 'Get the Red role',
              value: 'role_red',
              emoji: { name: '🔴' }
            },
            {
              label: 'Blue',
              description: 'Get the Blue role',
              value: 'role_blue',
              emoji: { name: '🔵' }
            },
            {
              label: 'Green',
              description: 'Get the Green role',
              value: 'role_green',
              emoji: { name: '🟢' }
            }
          ],
          min_values: 1,
          max_values: 1
        }
      ]
    },
    {
      type: 1, // Action Row
      components: [
        {
          type: 2, // Button
          label: 'Announcement Ping',
          style: 1,
          custom_id: 'role_announcement',
          emoji: '📢'
        },
        {
          type: 2,
          label: 'War Ping',
          style: 1,
          custom_id: 'role_war',
          emoji: '⚔️'
        },
        {
          type: 2,
          label: 'Teamer Ping',
          style: 1,
          custom_id: 'role_teamer',
          emoji: '🧑🏻‍🤝‍🧑🏻'
        }
      ]
    }
  ]
};

async function sendWebhookMessage() {
  const res = await fetch(webhookURL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if(res.ok) {
    console.log('Message sent!');
  } else {
    console.error('Error sending webhook:', res.statusText);
  }
}

sendWebhookMessage();

