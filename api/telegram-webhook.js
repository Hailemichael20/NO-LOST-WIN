import { getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdminApp } from '../lib/firebase-admin.js';
import { reviewReceipt } from '../lib/receipt-review.js';
import {
  hasValidTelegramSecret,
  isTelegramAdminUser,
  parseReceiptCallback,
} from '../lib/telegram-webhook.js';

async function answerCallbackQuery(botToken, callbackQueryId, text) {
  const telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
  const result = await telegramResponse.json();
  if (!telegramResponse.ok || !result.ok) {
    throw new Error('Telegram could not confirm the callback.');
  }
}

async function editReviewedMessage(botToken, message, resultText) {
  if (!message?.chat?.id || !Number.isInteger(message.message_id)) return;
  const telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: message.chat.id,
      message_id: message.message_id,
      text: `${message.text || 'Receipt review'}\n\n${resultText}`,
      reply_markup: { inline_keyboard: [] },
    }),
  });
  const result = await telegramResponse.json();
  if (!telegramResponse.ok || !result.ok) {
    throw new Error('Telegram could not update the reviewed receipt message.');
  }
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed.' });
  }

  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const adminUserId = process.env.TELEGRAM_ADMIN_USER_ID;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!webhookSecret || !/^[0-9]+$/.test(adminUserId || '') || !botToken) {
    console.error('Telegram webhook environment variables are not configured.');
    return response.status(503).json({ error: 'Telegram webhook is not configured.' });
  }

  if (!hasValidTelegramSecret(request.headers['x-telegram-bot-api-secret-token'], webhookSecret)) {
    return response.status(401).json({ error: 'Invalid Telegram webhook secret.' });
  }

  const callback = request.body?.callback_query;
  if (!callback) return response.status(200).json({ ok: true });

  if (!isTelegramAdminUser(callback.from?.id, adminUserId)) {
    await answerCallbackQuery(botToken, callback.id, 'You are not authorized to review receipts.');
    return response.status(200).json({ ok: true });
  }

  const action = parseReceiptCallback(callback.data);
  if (!action) {
    await answerCallbackQuery(botToken, callback.id, 'This review action is invalid.');
    return response.status(200).json({ ok: true });
  }

  try {
    const result = await reviewReceipt(
      getFirestore(getFirebaseAdminApp()),
      action.entryId,
      action.status,
      `telegram:${adminUserId}`,
      { onlyPending: true },
    );

    const answer = result.alreadyFinal
      ? 'Already reviewed / አስቀድሞ ተገምግሟል።'
      : action.status === 'approved'
        ? `Confirmed: ${result.amount} Birr credited / ተረጋግጧል፦ ${result.amount} ብር ተጨምሯል።`
        : 'Rejected / ውድቅ ተደርጓል።';
    await answerCallbackQuery(botToken, callback.id, answer);
    await editReviewedMessage(botToken, callback.message, answer);
    return response.status(200).json({ ok: true, alreadyFinal: result.alreadyFinal });
  } catch (error) {
    console.error('Telegram receipt review error:', error);
    return response.status(500).json({ error: 'Could not update registration status.' });
  }
}
