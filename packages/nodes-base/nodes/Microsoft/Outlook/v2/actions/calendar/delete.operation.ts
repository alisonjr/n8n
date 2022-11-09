import { IExecuteFunctions } from 'n8n-core';
import { INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { microsoftApiRequest } from '../../transport';

export const description: INodeProperties[] = [];

export async function execute(
	this: IExecuteFunctions,
	index: number,
): Promise<INodeExecutionData[]> {
	const calendarId = this.getNodeParameter('calendarId', index) as string;
	await microsoftApiRequest.call(this, 'DELETE', `/calendars/${calendarId}`);

	const executionData = this.helpers.constructExecutionMetaData(
		this.helpers.returnJsonArray({ success: true }),
		{ itemData: { item: index } },
	);

	return executionData;
}