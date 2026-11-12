/** Normalize npm's CycloneDX project identity without depending on the checkout name. */
export function projectSbom(input, packageMetadata, supplemental = null) {
  const { name, version } = packageMetadata;
  if (
    typeof name !== 'string' ||
    !/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(name) ||
    typeof version !== 'string' ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)
  )
    throw new Error('INVALID_SBOM_PROJECT_IDENTITY');

  const body = structuredClone(input);
  if (
    body?.bomFormat !== 'CycloneDX' ||
    !body.metadata?.component ||
    typeof body.metadata.component !== 'object' ||
    Array.isArray(body.metadata.component) ||
    !Array.isArray(body.dependencies)
  )
    throw new Error('INVALID_SBOM_STRUCTURE');

  const component = body.metadata.component;
  const oldRef = component['bom-ref'];
  const oldPurl = component.purl;
  if (typeof oldRef !== 'string' || !oldRef) throw new Error('MISSING_SBOM_ROOT_REFERENCE');

  const rootRef = `${name}@${version}`;
  const purl = `pkg:npm/${name.replace('@', '%40')}@${version}`;
  let omitted = 0;
  function project(value) {
    if (typeof value === 'string') {
      if (value === oldRef) return rootRef;
      if (typeof oldPurl === 'string' && value === oldPurl) return purl;
      return value;
    }
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) value[index] = project(value[index]);
      return value;
    }
    if (!value || typeof value !== 'object') return value;
    for (const key of Object.keys(value)) {
      if (['author', 'authors', 'email', 'phone'].includes(key.toLowerCase())) {
        delete value[key];
        omitted++;
      } else value[key] = project(value[key]);
    }
    return value;
  }
  project(body);
  component.name = name;
  component.version = version;
  component['bom-ref'] = rootRef;
  component.purl = purl;
  if (body.dependencies.filter((entry) => entry.ref === rootRef).length !== 1)
    throw new Error('INVALID_SBOM_ROOT_DEPENDENCY');
  if (body.components?.some((entry) => entry['bom-ref'] === rootRef))
    throw new Error('DUPLICATE_SBOM_ROOT_REFERENCE');

  if (supplemental !== null) {
    if (
      supplemental?.format !== 'travel-reliability-python-inventory/1' ||
      !Array.isArray(supplemental.components) ||
      !Array.isArray(supplemental.dependencies) ||
      !Array.isArray(supplemental.roots) ||
      !Array.isArray(supplemental.properties)
    )
      throw new Error('INVALID_SBOM_SUPPLEMENT');
    body.components ??= [];
    const references = new Set([rootRef, ...body.components.map((entry) => entry['bom-ref'])]);
    for (const extra of structuredClone(supplemental.components)) {
      if (typeof extra['bom-ref'] !== 'string' || references.has(extra['bom-ref']))
        throw new Error('DUPLICATE_SBOM_COMPONENT_REFERENCE');
      references.add(extra['bom-ref']);
      body.components.push(extra);
    }
    body.dependencies.push(...structuredClone(supplemental.dependencies));
    if (supplemental.roots.some((reference) => !references.has(reference)))
      throw new Error('INVALID_SBOM_SUPPLEMENT_ROOT');
    const rootDependency = body.dependencies.find((entry) => entry.ref === rootRef);
    rootDependency.dependsOn = [
      ...new Set([...rootDependency.dependsOn, ...supplemental.roots]),
    ].sort();
    const dependencyRefs = new Set();
    for (const dependency of body.dependencies) {
      if (
        !references.has(dependency.ref) ||
        dependencyRefs.has(dependency.ref) ||
        !Array.isArray(dependency.dependsOn) ||
        dependency.dependsOn.some((reference) => !references.has(reference))
      )
        throw new Error('INVALID_SBOM_DEPENDENCY_GRAPH');
      dependencyRefs.add(dependency.ref);
    }
    body.metadata.properties ??= [];
    body.metadata.properties.push(...structuredClone(supplemental.properties));
    project(body);
  }

  body.metadata.properties ??= [];
  if (!Array.isArray(body.metadata.properties)) throw new Error('INVALID_SBOM_PROPERTIES');
  body.metadata.properties = body.metadata.properties.filter(
    (entry) =>
      !['travel-reliability:privacy-projection', 'travel-reliability:project-identity'].includes(
        entry.name,
      ),
  );
  body.metadata.properties.push(
    {
      name: 'travel-reliability:privacy-projection',
      value:
        'Optional author, authors, email and phone fields omitted; package versions, hashes, licenses and references retained.',
    },
    {
      name: 'travel-reliability:project-identity',
      value:
        'Root name, version, package URL and dependency reference normalized from package.json.',
    },
  );
  // Optional metadata must not disclose a local checkout, home directory or file URI.
  if (/(?:^|[\s"'=])(?:[A-Za-z]:[\\/]|file:\/\/|\/(?:Users|home)\/)/m.test(JSON.stringify(body)))
    throw new Error('LOCAL_PATH_IN_SBOM');
  return { body, omitted };
}
