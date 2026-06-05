import { Notification } from './models/index';
import { connectDB } from './db';

/**
 * Create in-app notification(s)
 * @param {string|string[]} userIds - one or many user _id values
 * @param {string} title
 * @param {string} message
 * @param {string} type  - 'leave' | 'attendance' | 'general'
 * @param {string} refId - optional reference id (e.g. leave _id)
 */
export async function notify(userIds, title, message, type = 'general', refId = null) {
  try {
    await connectDB();
    const ids = Array.isArray(userIds) ? userIds : [userIds];
    if (!ids.length) return;
    await Notification.insertMany(
      ids.map(userId => ({ userId, title, message, type, refId }))
    );
  } catch (e) {
    console.error('Notification failed:', e);
  }
}
