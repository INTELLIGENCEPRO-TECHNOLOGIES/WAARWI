import assert from 'node:assert/strict';

export async function verifyCalendarActions(dialog) {
  const footer = dialog.locator('.waarwi-window-footer');
  const actions = await footer.evaluate(element => {
    const area = element.getBoundingClientRect();
    return [...element.querySelectorAll('button')].map(button => {
      const { left, right, top, width, height } = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      return {
        label: button.innerText.trim(),
        left, right, top, width, height,
        insideFooter: left >= area.left && right <= area.right,
        borderRadius: style.borderRadius,
        fontSize: style.fontSize,
      };
    });
  });

  assert.deepEqual(actions.map(action => action.label), ['Réinitialiser', 'Annuler', 'Appliquer']);
  const first = actions[0];
  assert.ok(actions.every(action => action.insideFooter && action.height >= 40));
  assert.ok(actions.every(action => Math.abs(action.top - first.top) < 1), 'Les trois actions du calendrier doivent rester sur une seule ligne');
  assert.ok(actions.every(action => Math.abs(action.width - first.width) < 1 && action.height === first.height), 'Les trois actions du calendrier doivent avoir les mêmes dimensions');
  assert.ok(actions.every(action => action.borderRadius === first.borderRadius && action.fontSize === first.fontSize));
  const horizontalOrder = actions.toSorted((left, right) => left.left - right.left);
  assert.ok(horizontalOrder.slice(1).every((action, index) => action.left >= horizontalOrder[index].right), 'Les actions du calendrier ne doivent pas se chevaucher');
}
