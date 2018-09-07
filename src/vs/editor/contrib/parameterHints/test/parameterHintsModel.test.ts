/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CancellationToken } from 'vs/base/common/cancellation';
import { dispose, IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { Position } from 'vs/editor/common/core/position';
import { Handler } from 'vs/editor/common/editorCommon';
import { ITextModel } from 'vs/editor/common/model';
import { TextModel } from 'vs/editor/common/model/textModel';
import * as modes from 'vs/editor/common/modes';
import { createTestCodeEditor, TestCodeEditor } from 'vs/editor/test/browser/testCodeEditor';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { IStorageService, NullStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { NullTelemetryService } from 'vs/platform/telemetry/common/telemetryUtils';
import { ParameterHintsModel } from '../parameterHintsWidget';

function createMockEditor(model: TextModel): TestCodeEditor {
	return createTestCodeEditor({
		model: model,
		serviceCollection: new ServiceCollection(
			[ITelemetryService, NullTelemetryService],
			[IStorageService, NullStorageService]
		)
	});
}


suite('ParameterHintsModel', () => {
	let disposables: IDisposable[] = [];

	setup(function () {
		disposables = dispose(disposables);
	});

	test('Provider should get trigger character on type', (done) => {
		const textModel = TextModel.createFromString('', undefined, undefined, URI.parse('test:somefile.ttt'));
		disposables.push(textModel);

		const editor = createMockEditor(textModel);
		disposables.push(new ParameterHintsModel(editor));

		disposables.push(modes.SignatureHelpProviderRegistry.register({ scheme: 'test' }, new class implements modes.SignatureHelpProvider {
			signatureHelpTriggerCharacters: string[] = ['('];

			provideSignatureHelp(_model: ITextModel, _position: Position, _token: CancellationToken, context: modes.SignatureHelpContext): modes.SignatureHelp | Thenable<modes.SignatureHelp> {
				assert.strictEqual(context.triggerReason, modes.SignatureHelpTriggerReason.TriggerCharacter);
				assert.strictEqual(context.triggerCharacter, '(');
				done();
				return undefined;
			}
		}));

		editor.trigger('keyboard', Handler.Type, { text: '(' });
	});

	test('Provider should get last trigger character when triggered multiple times and only be invoked once', (done) => {
		const textModel = TextModel.createFromString('', undefined, undefined, URI.parse('test:somefile.ttt'));
		disposables.push(textModel);

		const editor = createMockEditor(textModel);
		disposables.push(new ParameterHintsModel(editor, 5));

		let invokeCount = 0;
		disposables.push(modes.SignatureHelpProviderRegistry.register({ scheme: 'test' }, new class implements modes.SignatureHelpProvider {
			signatureHelpTriggerCharacters: string[] = ['a', 'b', 'c'];

			provideSignatureHelp(_model: ITextModel, _position: Position, _token: CancellationToken, context: modes.SignatureHelpContext): modes.SignatureHelp | Thenable<modes.SignatureHelp> {
				++invokeCount;
				assert.strictEqual(context.triggerReason, modes.SignatureHelpTriggerReason.TriggerCharacter);
				assert.strictEqual(context.triggerCharacter, 'c');

				// Give some time to allow for later triggers
				setTimeout(() => {
					assert.strictEqual(invokeCount, 1);

					done();
				}, 50);
				return undefined;
			}
		}));

		editor.trigger('keyboard', Handler.Type, { text: 'a' });
		editor.trigger('keyboard', Handler.Type, { text: 'b' });
		editor.trigger('keyboard', Handler.Type, { text: 'c' });
	});

	test.skip('Provider should be retriggered if already active', (done) => {
		const textModel = TextModel.createFromString('', undefined, undefined, URI.parse('test:somefile.ttt'));
		disposables.push(textModel);

		const editor = createMockEditor(textModel);
		disposables.push(new ParameterHintsModel(editor, 5));

		let invokeCount = 0;
		disposables.push(modes.SignatureHelpProviderRegistry.register({ scheme: 'test' }, new class implements modes.SignatureHelpProvider {
			signatureHelpTriggerCharacters: string[] = ['a', 'b'];

			provideSignatureHelp(_model: ITextModel, _position: Position, _token: CancellationToken, context: modes.SignatureHelpContext): modes.SignatureHelp | Thenable<modes.SignatureHelp> {
				++invokeCount;
				if (invokeCount === 1) {
					assert.strictEqual(context.triggerReason, modes.SignatureHelpTriggerReason.TriggerCharacter);
					assert.strictEqual(context.triggerCharacter, 'a');

					// retrigger after delay for widget to show up
					setTimeout(() => editor.trigger('keyboard', Handler.Type, { text: 'b' }), 50);
				} else if (invokeCount === 2) {
					assert.strictEqual(context.triggerReason, modes.SignatureHelpTriggerReason.Retrigger);
					assert.strictEqual(context.triggerCharacter, 'b');
					done();
				} else {
					assert.fail('Unexpected invoke');
				}

				return {
					signatures: [{
						label: 'none',
						parameters: []
					}],
					activeParameter: 0,
					activeSignature: 0
				};
			}
		}));

		editor.trigger('keyboard', Handler.Type, { text: 'a' });
	});

	test('Should cancel existing request when new request comes in', () => {
		const textModel = TextModel.createFromString('abc def', undefined, undefined, URI.parse('test:somefile.ttt'));
		disposables.push(textModel);

		const editor = createMockEditor(textModel);
		const hintsModel = new ParameterHintsModel(editor);

		let didRequestCancellationOf = -1;
		let invokeCount = 0;
		const longRunningProvider = new class implements modes.SignatureHelpProvider {
			signatureHelpTriggerCharacters: string[] = [];

			provideSignatureHelp(_model: ITextModel, _position: Position, token: CancellationToken): modes.SignatureHelp | Thenable<modes.SignatureHelp> {
				const count = invokeCount++;
				token.onCancellationRequested(() => { didRequestCancellationOf = count; });

				// retrigger on first request
				if (count === 0) {
					hintsModel.trigger({ triggerReason: modes.SignatureHelpTriggerReason.Invoke }, 0);
				}

				return new Promise<modes.SignatureHelp>(resolve => {
					setTimeout(() => {
						resolve({
							signatures: [{
								label: '' + count,
								parameters: []
							}],
							activeParameter: 0,
							activeSignature: 0
						});
					}, 100);
				});
			}
		};

		disposables.push(modes.SignatureHelpProviderRegistry.register({ scheme: 'test' }, longRunningProvider));

		hintsModel.trigger({ triggerReason: modes.SignatureHelpTriggerReason.Invoke }, 0);
		assert.strictEqual(-1, didRequestCancellationOf);

		return new Promise((resolve, reject) =>
			hintsModel.onHint(e => {
				try {
					assert.strictEqual(0, didRequestCancellationOf);
					assert.strictEqual('1', e.hints.signatures[0].label);
					resolve();
				} catch (e) {
					reject(e);
				}
			}));
	});
});
