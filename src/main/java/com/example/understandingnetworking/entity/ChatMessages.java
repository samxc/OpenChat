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

    private String content;
    private String sender;
    private MessageType type;
    private String time;

    // Populated only when type == FILE.
    // Files are shared peer-to-peer (WebTorrent); we broadcast only the magnet link,
    // never the bytes. The actual file lives in the sender's browser while they're online.
    private String magnetUri;
    private String fileName;
    private String fileType;   // MIME type, e.g. "image/png"
    private Long fileSize;     // bytes

    public enum MessageType {
        CHAT,
        CONNECT,
        DISCONNECT,
        FILE
    }

}
