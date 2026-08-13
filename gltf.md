# glTF 파일 조사 내용

## 파일 위치
- `resources/models/airplane.gltf`: 3D 블랙박스에 표시되는 비행기 모델 파일

## 파일 형식 및 구조

### 기본 정보
- **형식**: glTF 2.0 JSON 형식
- **생성자**: `THREE.GLTFExporter r176` (Three.js GLTFExporter 버전 176)
- **버전**: `asset.version: "2.0"`

### 파일 구조
GLTF 파일은 다음 주요 섹션으로 구성됨:

1. **asset**: 파일 메타데이터 (버전, 생성자 정보)
2. **scenes**: 씬 정의 (노드 참조)
3. **scene**: 기본 씬 인덱스
4. **nodes**: 씬 내 객체들 (위치, 회전, 스케일, 메쉬 참조)
   - 주요 노드: `fuselage_1`, `Cylinder_0`, `plane_2`, `Cylinder001_3`, `Circle_4` 등
5. **meshes**: 메쉬 정의 (모드, 어트리뷰트, 인디케이스, 재질)
6. **buffers/bufferViews**: 버텍스 데이터, 노말, 텍스처 좌표
7. **accessors**: 버퍼 뷰 내의 데이터 접근 정보 (위치, 노말, 텍스처 좌표 등)
8. **materials**: 표면 재질 (pbrMetallicRoughness, doubleSided, 이름)

### 주요 재질
- `metal`: 금속 재질 (기본 색상: 회색, 금속 계수: 0.5, 거칠기: 0.5)
- `body_paint`: 기체 페인트 (기본 색상: 주황/노랑, 금속 계수: 0.1, 거칠기: 0.2)
- `rubber`: 고무 재질 (검은색, 금속: 0, 거칠기: 1)
- `wood`: 목재 재질 (갈색, 금속: 0, 거칠기: 0.5)
- `Material.002`: 기본 재질 (금속: 1, 거칠기: 1)

### Three.js 호환성 및 다양한 포맷 지원
- **GLTFLoader**: Three.js `GLTFLoader`를 통해 다음 형식 모두 지원
  - **JSON 형식**: `.gltf` (인라인 텍스처 또는 외부 파일 참조)
  - **Binary 형식**: `.glb` (모든 데이터가 포함된 단일 바이너리 파일)
- **내부 인코딩 지원**:
  - **KHR_draco_mesh_compression**: 메쉬 기하학 DRACO 압축 (파일 크기 감소)
  - **KHR_texture_basisu**: Basis Universal 텍스처 압축 (고효율 텍스처 로딩)
  - **KHR_meshopt_compression**: meshopt 압축 (버퍼 데이터 크기 감소)
  - **KHR_lights_punctual**: punctual 라이트 (디렉셔널, 포인트, 스팟 라이트)
- **로드 가능**: 브라우저에서 직접 Three.js GLTFLoader로 로드 가능

### 변환 가능성
- **GLB 변환**: Three.js `GLTFExporter` 또는 Blender를 통해 glTF → GLB 변환 가능
- **텍스처 포함**: 외부 텍스처 파일(.jpg, .png) 또는 데이터 URI를 통해 텍스처 포함 가능
- **JSON ↔ GLB 변환**: `GLTFExporter`/`GLTFLoader` 조합으로 형식 상호 변환 지원
- **DRACO 압축 해제**: 필요에 따라 DRACO 압축된 glTF 파일을 일반 JSON으로 변환 가능

### 뷰어에서의 사용
- `src/blackbox-viewer/components/MapAirplane.vue`에서 `./resources/models/airplane.gltf` 로드
- Three.js 기반 3D 렌더링을 통해 비행기 모델 표시
- 프로펠러 회전, 기체 태도 표시 등 블랙박스 재생 기능과 연동