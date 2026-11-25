import {describe,expect,it} from 'vitest';
import {pageList,rangesOf} from '../src/import/document';

describe('choosing catalogue pages',()=>{
 it('reads pages and ranges in order, once each',()=>{
  expect(pageList('40–42, 3; 12 - 13, 41',50)).toEqual([3,12,13,40,41,42]);
  expect(pageList('  ',50)).toEqual([]);
 });
 it('refuses words and pages outside the document',()=>{
  expect(()=>pageList('page 3',50)).toThrow(/not a page/);
  expect(()=>pageList('48-52',50)).toThrow(/outside pages 1 to 50/);
  expect(()=>pageList('0',50)).toThrow(/outside/);
 });
 it('writes pages back as ranges',()=>{
  expect(rangesOf([14,3,12,13,13,40])).toBe('3, 12-14, 40');
  expect(rangesOf([])).toBe('');
 });
});
