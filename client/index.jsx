/* Build entry: bundles the Dot client and registers it with the host ModuleLoader. */
import createDotClient from './app.jsx';

const build = __DOT_BUILD__;

window.__ModuleLoader__.load({
  id: '@oxmumu3/dsh-project-companion',
  factory: require => {
    console.log('dot client build ' + build);
    return createDotClient(require);
  },
});
