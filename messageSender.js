const { WebhookClient, EmbedBuilder } = require("discord.js");

const webhookCache = new Map();

/**
 * Gets or creates a webhook in the given channel.
 */
async function getOrCreateWebhook(channel) {
    if (webhookCache.has(channel.id)) return webhookCache.get(channel.id);

    const webhooks = await channel.fetchWebhooks();
    let webhook = webhooks.find(w => w.owner.id === channel.client.user.id);

    if (!webhook) {
        webhook = await channel.createWebhook({
            name: "Auto Sender",
            avatar: channel.client.user.displayAvatarURL(),
        });
    }

    webhookCache.set(channel.id, webhook);
    return webhook;
}

/**
 * Smart message sender.
 */
async function sendMessage(channel, options) {
    const { content, embeds, components, useWebhook = false, webhookOptions = {} } = options;

    // If interactions exist, we must use a bot message
    const hasInteractions = components && components.length > 0;

    if (useWebhook && !hasInteractions) {
        const webhook = await getOrCreateWebhook(channel);
        return await webhook.send({
            content,
            embeds,
            username: webhookOptions.username || undefined,
            avatarURL: webhookOptions.avatarURL || undefined,
        });
    }

    // Fallback to bot message
    return await channel.send({
        content,
        embeds,
        components,
    });
}

module.exports = { sendMessage };
