import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AutoComplete } from '@uxcommon/components/autocomplete/autocomplete';
import { TagsService } from '@experiences/tags/services/tags-service';
import { QueryBuilderGroupNode, QueryBuilderNode, QueryBuilderRuleNode } from '@common';

export interface QueryBuilderField {
  name: string;
  label: string;
  operators: { value: string; label: string }[];
  inputType: 'text' | 'autocomplete' | 'select' | 'number' | 'none';
  choices?: { value: string; label: string }[];
}

@Component({
  selector: 'pc-query-builder',
  imports: [CommonModule, AutoComplete],
  templateUrl: 'query-builder.html',
})
export class QueryBuilderComponent {
  // Inputs
  public readonly group = input.required<QueryBuilderGroupNode>();
  public readonly fields = input.required<QueryBuilderField[]>();
  public readonly tagSvc = input<TagsService>();
  public readonly showSummary = input<boolean>(true);
  public readonly summaryMatches = input<number | null>(null);
  public readonly summaryCounting = input<boolean>(false);
  public readonly summaryError = input<string | null>(null);

  // Outputs
  public readonly changed = output<void>();

  // Actions
  public addGroup() {
    this.group().rules.push({
      kind: 'group',
      id: Math.random().toString(36).substring(2),
      conjunction: 'AND',
      rules: [],
    });
    this.emitChange();
  }

  public addRule() {
    const defaultField = this.fields()[0];
    const defaultFieldName = defaultField?.name || '';
    const defaultOp = defaultField?.operators[0]?.value || '';

    this.group().rules.push({
      kind: 'rule',
      id: Math.random().toString(36).substring(2),
      field: defaultFieldName,
      op: defaultOp,
      value: '',
    });
    this.emitChange();
  }

  public removeItem(index: number) {
    this.group().rules.splice(index, 1);
    this.emitChange();
  }

  public setConjunction(conj: 'AND' | 'OR') {
    this.group().conjunction = conj;
    this.emitChange();
  }

  public setField(index: number, fieldName: string) {
    const node = this.group().rules[index]!;
    if (this.isRule(node)) {
      const fieldDef = this.getFieldDef(fieldName);
      node.field = fieldName;
      node.op = fieldDef?.operators[0]?.value || '';
      node.value = '';
      this.emitChange();
    }
  }

  public setOp(index: number, op: string) {
    const node = this.group().rules[index]!;
    if (this.isRule(node)) {
      node.op = op;
      // Reset value if we switch to empty/notempty
      if (['empty', 'notempty', 'isEmpty', 'isNotEmpty'].includes(op)) {
        node.value = undefined;
      }
      this.emitChange();
    }
  }

  public setRuleValue(index: number, value: any) {
    const node = this.group().rules[index]!;
    if (this.isRule(node)) {
      node.value = value;
      this.emitChange();
    }
  }

  public emitChange() {
    this.changed.emit();
  }

  // Type Guards & Helpers
  public isRule(node: QueryBuilderNode): node is QueryBuilderRuleNode {
    return node.kind === 'rule';
  }

  public isGroup(node: QueryBuilderNode): node is QueryBuilderGroupNode {
    return node.kind === 'group';
  }

  public asGroup(node: QueryBuilderNode): QueryBuilderGroupNode {
    return node as QueryBuilderGroupNode;
  }

  public getFieldDef(fieldName: string): QueryBuilderField | undefined {
    return this.fields().find((f) => f.name === fieldName);
  }

  public showValueInput(node: QueryBuilderRuleNode): boolean {
    return !['empty', 'notempty', 'isEmpty', 'isNotEmpty'].includes(node.op);
  }

  // Summary builder
  public summarizeGroup(group: QueryBuilderGroupNode): string {
    if (!group.rules?.length) return '(Everyone)';
    const parts = group.rules.map((node: QueryBuilderNode) => this.summarizeNode(node));
    const joiner = ` ${group.conjunction} `;
    return `(${parts.join(joiner)})`;
  }

  private summarizeNode(node: QueryBuilderNode): string {
    if (this.isRule(node)) {
      const fieldDef = this.getFieldDef(node.field);
      const fieldLabel = fieldDef?.label || node.field;
      // Read the summary back in the words the pickers used ("is 'Active'"),
      // not the wire values ("eq 'active'") — it is the same sentence the Lists
      // table shows under DEFINITION.
      const opLabel = fieldDef?.operators.find((o) => o.value === node.op)?.label ?? node.op;
      if (['empty', 'notempty', 'isEmpty', 'isNotEmpty'].includes(node.op)) {
        return `(${fieldLabel} ${opLabel})`;
      }
      const val = fieldDef?.choices?.find((c) => c.value === node.value)?.label ?? node.value ?? '…';
      return `(${fieldLabel} ${opLabel} '${val}')`;
    }
    return this.summarizeGroup(node as QueryBuilderGroupNode);
  }
}
