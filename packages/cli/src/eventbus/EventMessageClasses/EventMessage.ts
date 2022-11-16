/* eslint-disable @typescript-eslint/no-explicit-any */
import { JsonObject } from 'n8n-workflow';
import {
	AbstractEventMessage,
	EventMessageSerialized,
	isEventMessageSerialized,
} from './AbstractEventMessage';
import { EventMessageTypeNames } from './Helpers';

export class EventPayload {
	msg?: string;
}

export class EventMessage extends AbstractEventMessage {
	readonly __type: string = EventMessageTypeNames.eventMessage;

	payload: EventPayload;

	setPayload(payload: EventPayload): this {
		this.payload = payload;
		return this;
	}

	serialize(): EventMessageSerialized {
		// TODO: filter payload for sensitive info here?
		return {
			__type: this.__type,
			id: this.id,
			ts: this.ts.toISO(),
			eventName: this.eventName,
			level: this.level,
			payload: this.payload ?? new EventPayload(),
		};
	}

	deserialize(data: JsonObject): this {
		if (isEventMessageSerialized(data, this.__type)) {
			this.setOptionsOrDefault(data);
			if (data.payload) this.setPayload(data.payload as EventPayload);
		}
		return this;
	}
}
