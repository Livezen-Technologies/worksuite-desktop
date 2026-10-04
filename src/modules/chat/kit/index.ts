/**
 * The shared chat kit (C-02; worksuite-desktop#229): Team Chat and website chats render their messages with these
 * components. Channel-specific pieces (Team Chat's call and record cards) are passed in as renderers, so a website
 * chat never loads them.
 */
export { TEAM_CAPS, WEBSITE_CAPS, type ChannelCaps } from './caps';
export { byTime, eventsForThread, fromChatMessage, fromWebsiteMessage, fromWidgetEvent, websiteFileUrl, type KitFile, type KitMessage, type KitRole, type TeamChatMessage } from './model';
export { groupMessages, positionIn, type KitItem, type KitRow, type KitSlot, type Position } from './grouping';
export { ActivityEvent, DayDivider, MessageGroup, MessageList, PendingBubble, SystemLine, TypingLine, relativeDay } from './MessageList';
export { MessageBubble, nameColour, type KitRenderers } from './MessageBubble';
export { MessageMeta, MessageStatus } from './MessageMeta';
export { DeleteDialog, MessageMenu, messageActionItems, type MenuItem, type MessageHandlers } from './MessageActions';
export { AttachmentGrid, FileCard, MessageAttachment, MessageAttachments, readableName } from './MessageAttachment';
export { LinkPreview, shortUrl, type LinkPreviewData } from './LinkPreview';
export { SharedFiles, sharedFilesOf, type SharedFile } from './SharedFiles';
