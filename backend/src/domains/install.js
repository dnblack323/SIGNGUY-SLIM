export function methodsFromClass(MethodClass) {
  return Object.fromEntries(
    Object.getOwnPropertyNames(MethodClass.prototype)
      .filter((name) => name !== "constructor")
      .map((name) => [name, MethodClass.prototype[name]]),
  );
}

export function installDomainMethods(SlimService, { domainName, installedSymbol, methodGroups }) {
  if (SlimService[installedSymbol]) return;
  const methods = {};
  for (const group of methodGroups) {
    for (const [name, method] of Object.entries(group)) {
      if (Object.prototype.hasOwnProperty.call(methods, name)) throw new Error(domainName + "_domain_duplicate_method:" + name);
      methods[name] = method;
    }
  }
  const collisions = Object.keys(methods).filter((name) => Object.prototype.hasOwnProperty.call(SlimService.prototype, name));
  if (collisions.length) throw new Error(domainName + "_domain_method_collision:" + collisions.join(","));
  Object.assign(SlimService.prototype, methods);
  Object.defineProperty(SlimService, installedSymbol, { value: true });
}
