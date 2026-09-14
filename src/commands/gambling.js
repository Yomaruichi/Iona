function randomInteger(max) {
    return Math.floor(Math.random() * max)+1;
}

function dice(pieces, sides) {
    diceResult = [];
    diceSum = 0;
    for (let i=0;pieces>i;i++) {
        diceResult.push(randomInteger(sides));
    }
    for (let j=0;diceResult.length>j;j++) {
        diceSum += diceResult[j];
    }
    return diceSum
}

module.exports = { randomInteger, dice };

