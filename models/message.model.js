// models/message.model.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const messageSchema = new Schema({
    conversation_id: { 
        type: Schema.Types.ObjectId, // This is a special type for IDs
        ref: 'Conversation',         // This links it to the Conversation model
        required: true 
    },
    sender: { 
        type: String, 
        enum: ['user', 'ai'], // The sender must be one of these two values
        required: true 
    },
    content: { type: String, required: true }
}, {
    timestamps: true
});

const Message = mongoose.model('Message', messageSchema);
module.exports = Message;