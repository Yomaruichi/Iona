const { test } = require('node:test');
const assert = require('node:assert/strict');
const diceCommand = require('../src/commands/dice');
const { dice, randomInteger } = require('../src/commands/gambling');

test('rolling three six-sided dice returns an integer total between 3 and 18', () => {
    // Sample repeated rolls without expecting a particular random sequence.
    for (let attempt = 0; attempt < 100; attempt++) {
        const total = dice(3, 6);
        assert.ok(Number.isInteger(total) && total >= 3 && total <= 18);
        // A one-sided random roll has exactly one possible result.
        assert.equal(randomInteger(1), 1);
    }
});

test('/dice requires at least one die and at least two sides per die', () => {
    // Inspect the definition sent to Discord, where option constraints are enforced.
    const commandDefinition = diceCommand.data.toJSON();
    const optionConstraints = commandDefinition.options.map(option => ({
        name: option.name,
        required: option.required,
        minimum: option.min_value,
    }));

    assert.equal(commandDefinition.name, 'dice');
    assert.deepEqual(optionConstraints, [
        { name: 'pieces', required: true, minimum: 1 },
        { name: 'sides', required: true, minimum: 2 },
    ]);
});

test('/dice replies with the requested dice settings and a valid roll total', async () => {
    // Capture the reply locally instead of sending a Discord message.
    const selectedOptions = { pieces: 1, sides: 2 };
    let replyContent;
    const interaction = {
        options: { getInteger: name => selectedOptions[name] },
        reply: async content => { replyContent = content; },
    };

    await diceCommand.execute(interaction);

    // Either random outcome is valid, but the displayed settings must match the request.
    assert.match(replyContent, /^\*\*Pieces:\*\* 1\n\*\*Sides:\*\* 2\n\*\*You rolled:\*\* [12]$/);
});
