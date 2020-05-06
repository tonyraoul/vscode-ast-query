import { Disposable, commands, window, workspace, Uri } from 'vscode';
import * as esquery from 'esquery';
import * as estraverse from 'estraverse';
import { parse, visitorKeys } from '@typescript-eslint/typescript-estree';
import { Node } from 'estree';
import { Container } from '../Container';
import { ShowSearchResultsCommand } from './ShowSearchResultsCommand';
import { SearchResultsByFilePath, SearchScope } from '../common';
import config from '../config';

// eslint-disable-next-line @typescript-eslint/ban-ts-ignore
// @ts-ignore
Object.assign(estraverse.VisitorKeys, visitorKeys); // extend estraverse with TypeScript definitions

async function findMatches(files: Uri[], query: string): Promise<SearchResultsByFilePath> {
  const results = await Promise.all(files.map(async (file) => {
    const contents = (await workspace.fs.readFile(file)).toString();
    const ast = parse(contents);

    try {
      const matches = esquery.query(ast as Node, query);

      return {
        file,
        fileContents: contents,
        matches,
      };
    } catch (error) {
      error.file = file;
      throw error;
    }
  }));

  return results
    .filter((result) => result.matches.length > 0)
    .reduce((previous, current) => ({
      ...previous,
      [current.file.path]: current,
    }), {});
}

export class SearchCommand implements Disposable {
  public static key = 'ast-query.search';

  private disposable: Disposable;

  constructor() {
    this.disposable = commands.registerCommand(SearchCommand.key, async (query: string, {
      scope = SearchScope.global,
    }: {
      scope?: SearchScope;
    } = {}) => {
      const inFiles = await this.getFiles(scope);
      try {
        const results = await findMatches(inFiles, query);

        Container.searchHistoryView.push({ query, scope });
        Container.resultsView.show(results);
        Container.matchHighlightProvider.highlight(results);
        await commands.executeCommand(ShowSearchResultsCommand.key);
      } catch (error) {
        if (error.file) {
          const file = error.file as Uri;
          const message = `Unable to perform AST search on file "${file.path}", might contain unrecognized syntax`;
          window.showErrorMessage(message);
        } else {
          throw error;
        }
      }
    });
  }

  private async getFiles(scope: SearchScope) {
    switch (scope) {
      case SearchScope.activeFile: {
        const uri = window.activeTextEditor?.document.uri;
        return uri ? [uri] : [];
      }
      case SearchScope.global:
        return workspace.findFiles(config.globalFileGlob, config.globalIgnoreGlob);
      default:
        throw new Error('Invalid search scope');
    }
  }

  dispose() {
    return this.disposable.dispose();
  }
}
