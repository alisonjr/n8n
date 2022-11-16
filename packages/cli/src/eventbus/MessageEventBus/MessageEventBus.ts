import { JsonValue } from 'n8n-workflow';
import { DeleteResult } from 'typeorm';
import { EventMessage } from '../EventMessageClasses/EventMessage';
import {
	EventMessageSubscriptionSet,
	EventMessageSubscriptionSetOptions,
} from '../EventMessageClasses/EventMessageSubscriptionSet';
import { EventMessageTypes } from '../EventMessageClasses/Helpers';
import { MessageEventBusDestination } from '../EventMessageClasses/MessageEventBusDestination';
import { MessageEventBusLogWriter } from '../MessageEventBusWriter/MessageEventBusLogWriter';

interface MessageEventBusInitializationOptions {
	destinations?: MessageEventBusDestination[];
}

interface EventMessageDestinationStore {
	[key: string]: MessageEventBusDestination;
}

export interface EventMessageSubscribeDestination {
	subscriptionSet: EventMessageSubscriptionSetOptions;
	destinationId: string;
}

export type EventMessageReturnMode = 'sent' | 'unsent' | 'all';

class MessageEventBus {
	static #instance: MessageEventBus;

	isInitialized: boolean;

	logWriter: MessageEventBusLogWriter;

	destinations: EventMessageDestinationStore = {};

	#pushInteralTimer: NodeJS.Timer;

	constructor() {
		this.isInitialized = false;
	}

	static getInstance(): MessageEventBus {
		if (!MessageEventBus.#instance) {
			MessageEventBus.#instance = new MessageEventBus();
		}
		if (!MessageEventBus.#instance.isInitialized) {
			MessageEventBus.#instance.initialize().catch((error) => console.log(error));
		}
		return MessageEventBus.#instance;
	}

	async initialize(options?: MessageEventBusInitializationOptions) {
		if (this.isInitialized) {
			return;
		}

		// Register the thread serializer on the main thread
		// registerSerializer(messageEventSerializer);

		if (this.#pushInteralTimer) {
			clearInterval(this.#pushInteralTimer);
		}
		this.logWriter = await MessageEventBusLogWriter.getInstance();
		if (options?.destinations) {
			for (const destination of options?.destinations) {
				this.destinations[destination.getId()] = destination;
			}
		}

		await this.send(
			new EventMessage({
				eventName: 'n8n.core.eventBusInitialized',
				level: 'debug',
			}),
		);

		// check for unsent messages
		await this.#trySendingUnsent();

		// now start the logging to a fresh event log
		await this.logWriter.startLogging();

		this.#pushInteralTimer = setInterval(async () => {
			// console.debug('Checking for unsent messages...');
			await this.#trySendingUnsent();
		}, 5000);

		console.debug('MessageEventBus initialized');
		this.isInitialized = true;
	}

	async addDestination(destination: MessageEventBusDestination) {
		await this.removeDestination(destination.getId());
		this.destinations[destination.getId()] = destination;
		return destination;
	}

	async findDestination(id?: string): Promise<JsonValue[]> {
		if (id && Object.keys(this.destinations).includes(id)) {
			return [this.destinations[id].serialize()];
		} else {
			return Object.keys(this.destinations).map((e) => this.destinations[e].serialize());
		}
	}

	async removeDestination(id: string): Promise<DeleteResult | undefined> {
		let result;
		if (Object.keys(this.destinations).includes(id)) {
			await this.destinations[id].close();
			result = await this.destinations[id].deleteFromDb();
			delete this.destinations[id];
		}
		return result;
	}

	/**
	 * Resets SubscriptionsSet to empty values on the selected destination
	 * @param destinationId the destination id
	 * @returns serialized destination after reset
	 */
	getDestinationSubscriptionSet(destinationId: string): JsonValue {
		if (Object.keys(this.destinations).includes(destinationId)) {
			return this.destinations[destinationId].subscriptionSet.serialize();
		}
		return {};
	}

	/**
	 * Sets SubscriptionsSet on the selected destination
	 * @param destinationId the destination id
	 * @param subscriptionSetOptions EventMessageSubscriptionSet object containing event subscriptions
	 * @returns serialized destination after change
	 */
	setDestinationSubscriptionSet(
		destinationId: string,
		subscriptionSetOptions: EventMessageSubscriptionSetOptions,
	): MessageEventBusDestination {
		if (Object.keys(this.destinations).includes(destinationId)) {
			this.destinations[destinationId].setSubscription(subscriptionSetOptions);
		}
		return this.destinations[destinationId];
	}

	/**
	 * Resets SubscriptionsSet to empty values on the selected destination
	 * @param destinationId the destination id
	 * @returns serialized destination after reset
	 */
	resetDestinationSubscriptionSet(destinationId: string): MessageEventBusDestination {
		if (Object.keys(this.destinations).includes(destinationId)) {
			this.destinations[destinationId].setSubscription(
				new EventMessageSubscriptionSet({
					eventGroups: [],
					eventNames: [],
					eventLevels: [],
				}),
			);
		}
		return this.destinations[destinationId];
	}

	async #trySendingUnsent() {
		const unsentMessages = await this.getEventsUnsent();
		console.debug(`Found unsent EventMessages: ${unsentMessages.length}`);
		for (const unsentMsg of unsentMessages) {
			console.debug(`${unsentMsg.id} ${unsentMsg.__type}`);
			await this.#sendToDestinations(unsentMsg);
		}
	}

	async close() {
		await this.logWriter.close();
		for (const destinationName of Object.keys(this.destinations)) {
			await this.destinations[destinationName].close();
		}
	}

	async send(msg: EventMessageTypes) {
		await this.#writeMessageToLog(msg);
		await this.#sendToDestinations(msg);
	}

	async confirmSent(msg: EventMessageTypes) {
		await this.#writeConfirmationToLog(msg.id);
	}

	async #writeMessageToLog(msg: EventMessageTypes) {
		await this.logWriter.putMessage(msg);
	}

	async #writeConfirmationToLog(id: string) {
		await this.logWriter.confirmMessageSent(id);
	}

	async #sendToDestinations(msg: EventMessageTypes) {
		// if there are no destinations, immediately mark the event as sent
		if (Object.keys(this.destinations).length === 0) {
			await this.confirmSent(msg);
		} else {
			for (const destinationName of Object.keys(this.destinations)) {
				await this.destinations[destinationName].receiveFromEventBus(msg);
			}
		}
	}

	async getEvents(mode: EventMessageReturnMode = 'all'): Promise<EventMessageTypes[]> {
		let queryResult: EventMessageTypes[];
		switch (mode) {
			case 'all':
				queryResult = await this.logWriter.getMessages();
				break;
			case 'sent':
				queryResult = await this.logWriter.getMessagesSent();
				break;
			case 'unsent':
				queryResult = await this.logWriter.getMessagesUnsent();
		}
		return queryResult;
	}

	async getEventsSent() {
		const sentMessages = await this.getEvents('sent');
		return sentMessages;
	}

	async getEventsUnsent() {
		const unSentMessages = await this.getEvents('unsent');
		return unSentMessages;
	}
}

export const eventBus = MessageEventBus.getInstance();
