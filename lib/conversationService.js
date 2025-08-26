// /lib/conversationService.js
import Conversation from "../models/Conversation.js";
import Contact from "../models/Contact.js";

export async function appendConversationMessage({
  phone, role, source = "twilio", body, media = [], messageSid, lastStatus, statusHistory
}) {
  const now = new Date();
  const contact = await Contact.findOne({ phone }).lean();

  const update = {
    $push: {
      messages: {
        role,
        source,
        body: body || null,
        media: media.map(u => ({ url: u })),
        messageSid: messageSid || null,
        lastStatus: lastStatus || null,
        statusHistory: statusHistory?.length ? statusHistory : undefined,
        createdAt: now
      }
    },
    $set: {
      lastMessage: body || (media?.length ? "[media]" : ""),
      lastMessageAt: now,
      updatedAt: now,
      ...(contact ? { contactId: contact._id, status: contact.status } : {})
    }
  };

  return Conversation.findOneAndUpdate(
    { phone },
    update,
    { new: true, upsert: true }
  );
}
