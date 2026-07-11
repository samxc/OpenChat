package com.example.understandingnetworking.entity;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ChatMessages {

    private String id;         // unique id the server assigns to each CHAT / FILE message
    private String content;
    private String sender;
    private MessageType type;
    private String time;

    // Optional small profile picture (a resized image data-URL); applies to the sender.
    private String avatar;

    // Populated only when type == FILE.
    // Files are shared peer-to-peer (WebTorrent); we broadcast only the magnet link,
    // never the bytes. The actual file lives in the sender's browser while they're online.
    private String magnetUri;
    private String fileName;
    private String fileType;   // MIME type, e.g. "image/png"
    private Long fileSize;     // bytes

    // Populated only when type == REACTION.
    private String targetId;   // the id of the message being reacted to
    private String emoji;      // the reaction emoji, e.g. "👍"

    public enum MessageType {
        CHAT,
        CONNECT,
        DISCONNECT,
        FILE,
        REACTION
    }

}
